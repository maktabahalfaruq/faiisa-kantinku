/* FAIISA KantinKu prototype
 * Local-first demo: IndexedDB persistence, offline transaction queue, barcode camera/manual input.
 * Production deployment must add Firebase Auth, Firestore rules, server-side validation and sync worker.
 */
const DB_NAME = "faiisa-kantinku";
const DB_VERSION = 1;
const STORES = ["products", "sales", "expenses", "meta"];
let db;
let cart = [];
let scanStream = null;
let scanLoop = false;
let barcodeDetector = null;
let activePage = "dashboard";

const $ = id => document.getElementById(id);
const rupiah = value => new Intl.NumberFormat("id-ID", {style:"currency", currency:"IDR", maximumFractionDigits:0}).format(Number(value)||0);
const nowIso = () => new Date().toISOString();
const todayKey = () => new Date().toLocaleDateString("en-CA");
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const uid = prefix => `${prefix}_${Date.now().toString(36)}_${crypto.randomUUID ? crypto.randomUUID().slice(0,8) : Math.random().toString(36).slice(2,10)}`;

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("products")) {
        const store = database.createObjectStore("products", {keyPath:"id"});
        store.createIndex("barcode", "barcode", {unique:false});
      }
      if (!database.objectStoreNames.contains("sales")) {
        const store = database.createObjectStore("sales", {keyPath:"id"});
        store.createIndex("createdAt", "createdAt", {unique:false});
        store.createIndex("syncStatus", "syncStatus", {unique:false});
      }
      if (!database.objectStoreNames.contains("expenses")) database.createObjectStore("expenses", {keyPath:"id"});
      if (!database.objectStoreNames.contains("meta")) database.createObjectStore("meta", {keyPath:"key"});
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function txStore(store, mode="readonly") { return db.transaction(store, mode).objectStore(store); }
function getAll(store) {
  return new Promise((resolve,reject)=>{const r=txStore(store).getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error);});
}
function getOne(store,key) {
  return new Promise((resolve,reject)=>{const r=txStore(store).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
}
function put(store,value) {
  return new Promise((resolve,reject)=>{const t=db.transaction(store,"readwrite");t.objectStore(store).put(value);t.oncomplete=()=>resolve(value);t.onerror=()=>reject(t.error);});
}
function del(store,key) {
  return new Promise((resolve,reject)=>{const t=db.transaction(store,"readwrite");t.objectStore(store).delete(key);t.oncomplete=resolve;t.onerror=()=>reject(t.error);});
}
function clearStore(store) {
  return new Promise((resolve,reject)=>{const t=db.transaction(store,"readwrite");t.objectStore(store).clear();t.oncomplete=resolve;t.onerror=()=>reject(t.error);});
}
function toast(message, error=false) {
  const el=document.createElement("div");el.className="toast"+(error?" error":"");el.textContent=message;$("toastRegion").appendChild(el);setTimeout(()=>el.remove(),3600);
}
function showModal(id) { $(id).classList.add("open");$(id).setAttribute("aria-hidden","false"); }
function closeModal(id) { $(id).classList.remove("open");$(id).setAttribute("aria-hidden","true");if(id==="scanModal") stopCamera(); }
function fmtDate(value, withTime=true) {
  if(!value)return "—";const d=new Date(value);return d.toLocaleString("id-ID",withTime?{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}:{day:"2-digit",month:"short",year:"numeric"});
}
function isToday(value) { return new Date(value).toLocaleDateString("en-CA")===todayKey(); }

async function seedDemoIfEmpty() {
  const existing=await getAll("products");
  if(existing.length) return;
  const demo=[
    ["Roti cokelat","Makanan","899001",1800,2500,24,5],
    ["Air mineral 600 ml","Minuman","899002",1800,3000,30,8],
    ["Susu kotak","Minuman","899003",3500,5000,12,5],
    ["Biskuit kemasan","Makanan","899004",2500,3500,18,5],
    ["Keripik singkong","Camilan","899005",2000,3000,4,5],
    ["Pensil","Alat tulis","899006",1500,2500,15,4],
    ["Teh kotak","Minuman","899007",3000,4500,20,5],
    ["Wafer cokelat","Camilan","899008",1000,2000,26,5],
    ["Roti keju","Makanan","899009",2200,3500,0,5]
  ];
  for(const [name,category,barcode,cost,price,stock,minStock] of demo) {
    await put("products",{id:uid("prd"),name,category,barcode,cost,price,stock,minStock,active:true,createdAt:nowIso(),updatedAt:nowIso()});
  }
  await put("meta",{key:"canteenName",value:"Kantin Sekolah"});
}
async function allProducts() { return (await getAll("products")).filter(p=>p.active!==false).sort((a,b)=>a.name.localeCompare(b.name,"id")); }
async function allSales() { return (await getAll("sales")).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)); }
async function allExpenses() { return (await getAll("expenses")).sort((a,b)=>b.date.localeCompare(a.date)); }

function navigate(page) {
  activePage=page;
  document.querySelectorAll(".page").forEach(el=>el.classList.toggle("active",el.id===`page-${page}`));
  document.querySelectorAll(".nav-item").forEach(el=>el.classList.toggle("active",el.dataset.page===page));
  const labels={dashboard:["RINGKASAN OPERASIONAL","Dashboard"],kasir:["PENJUALAN","Kasir"],produk:["KATALOG & PERSEDIAAN","Produk & Stok"],transaksi:["RIWAYAT PENJUALAN","Transaksi"],keuangan:["PENCATATAN UANG","Keuangan"],laporan:["ANALISIS OPERASIONAL","Laporan"],pengaturan:["PREFERENSI APLIKASI","Pengaturan"]};
  $("pageEyebrow").textContent=labels[page][0];$("pageTitle").textContent=labels[page][1];
  $("sidebar").classList.remove("open");
  renderAll();
}
async function renderAll() {
  await updateConnection();
  await renderDashboard();
  await renderCashierProducts();
  await renderCart();
  await renderProductsTable();
  await renderTransactionsTable();
  await renderFinance();
  await renderReports();
  await renderCategories();
}
async function updateConnection() {
  const online=navigator.onLine;
  $("connectionText").textContent=online?"Online • cloud belum disambungkan":"Offline • data lokal";
  $("connectionDot").parentElement.classList.toggle("online",online);
}
async function renderDashboard() {
  const products=await allProducts(), sales=await allSales();
  const todaySales=sales.filter(s=>isToday(s.createdAt)&&s.status==="completed");
  const total=todaySales.reduce((n,s)=>n+s.total,0);
  $("statOmzet").textContent=rupiah(total);
  $("statTransaksi").textContent=todaySales.length;
  $("statProduk").textContent=products.length;
  $("statStok").textContent=products.filter(p=>p.stock<=p.minStock).length;
  const recent=sales.slice(0,5);
  $("recentTransactions").innerHTML=recent.length?tableHtml(["No. transaksi","Waktu","Total","Status"],recent.map(s=>[
    `<strong>${escapeHtml(s.number)}</strong>`,fmtDate(s.createdAt),rupiah(s.total),`<span class="${s.syncStatus==="synced"?"status-local":"status-pending"}">${s.syncStatus==="synced"?"Tersinkron":"Lokal / antrean"}</span>`
  ])):'<div class="empty-table">Belum ada transaksi. Buka menu Kasir untuk memulai.</div>';
  const low=products.filter(p=>p.stock<=p.minStock).sort((a,b)=>a.stock-b.stock).slice(0,6);
  $("lowStockList").innerHTML=low.length?low.map(p=>`<div class="low-stock-item"><div class="product-mini">${escapeHtml((p.name||"?").slice(0,1).toUpperCase())}</div><div class="info"><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.category)} · minimum ${p.minStock}</small></div><div class="stock-number">${p.stock} tersisa</div></div>`).join(""):'<div class="empty-table">Tidak ada stok rendah.</div>';
}
function tableHtml(headers, rows) {
  return `<table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.length?rows.map(row=>`<tr>${row.map(cell=>`<td>${cell}</td>`).join("")}</tr>`).join(""):`<tr><td colspan="${headers.length}" class="empty-table">Belum ada data.</td></tr>`}</tbody></table>`;
}
async function renderCategories() {
  const products=await allProducts(), selected=$("categoryFilter").value;
  const categories=[...new Set(products.map(p=>p.category).filter(Boolean))].sort();
  $("categoryFilter").innerHTML='<option value="">Semua kategori</option>'+categories.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  if(categories.includes(selected)) $("categoryFilter").value=selected;
}
async function renderCashierProducts() {
  const products=await allProducts(), q=$("productSearch").value.trim().toLowerCase(), cat=$("categoryFilter").value;
  const filtered=products.filter(p=>(!q||p.name.toLowerCase().includes(q)||(p.barcode||"").toLowerCase().includes(q))&&(!cat||p.category===cat));
  $("cashierProducts").innerHTML=filtered.map(p=>`<button class="product-card" data-add="${p.id}" ${p.stock<=0?"disabled":""}><div class="product-symbol">${escapeHtml((p.name||"?").slice(0,1).toUpperCase())}</div><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.category)} · stok ${p.stock}</small><div class="price">${rupiah(p.price)}</div></button>`).join("")||'<div class="empty-state">Produk tidak ditemukan.</div>';
  $("cashierProducts").querySelectorAll("[data-add]").forEach(btn=>btn.addEventListener("click",()=>addToCart(btn.dataset.add)));
}
async function addToCart(id) {
  const p=await getOne("products",id);if(!p||p.stock<=0){toast("Stok produk habis.",true);return;}
  const line=cart.find(x=>x.productId===id), qty=line?line.qty:0;
  if(qty+1>p.stock){toast("Jumlah melebihi stok yang tersedia.",true);return;}
  if(line)line.qty++;else cart.push({productId:id,name:p.name,price:p.price,cost:p.cost,qty:1});
  await renderCart();
}
async function renderCart() {
  $("cartItems").innerHTML=cart.length?cart.map(x=>`<div class="cart-line"><div class="cart-line-main"><strong>${escapeHtml(x.name)}</strong><small>${rupiah(x.price)} / item</small></div><div class="qty-controls"><button data-dec="${x.productId}" aria-label="Kurangi">−</button><span>${x.qty}</span><button data-inc="${x.productId}" aria-label="Tambah">+</button></div><strong>${rupiah(x.qty*x.price)}</strong></div>`).join(""):'<div class="empty-state">Belum ada produk dipilih.</div>';
  $("cartItems").querySelectorAll("[data-dec]").forEach(b=>b.addEventListener("click",()=>changeQty(b.dataset.dec,-1)));
  $("cartItems").querySelectorAll("[data-inc]").forEach(b=>b.addEventListener("click",()=>changeQty(b.dataset.inc,1)));
  const count=cart.reduce((n,x)=>n+x.qty,0), total=cart.reduce((n,x)=>n+x.qty*x.price,0);
  $("cartCount").textContent=`${count} item`; $("cartTotal").textContent=rupiah(total);
  const received=Number($("cashReceived").value)||0;
  $("changeAmount").textContent=$("paymentMethod").value==="Tunai"?rupiah(Math.max(0,received-total)):rupiah(0);
}
async function changeQty(id,delta) {
  const line=cart.find(x=>x.productId===id);if(!line)return;
  const p=await getOne("products",id), next=line.qty+delta;
  if(next<=0)cart=cart.filter(x=>x.productId!==id);
  else if(!p||next>p.stock)toast("Jumlah melebihi stok yang tersedia.",true);
  else line.qty=next;
  await renderCart();
}
async function completeSale() {
  if(!cart.length){toast("Keranjang masih kosong.",true);return;}
  const total=cart.reduce((n,x)=>n+x.qty*x.price,0), method=$("paymentMethod").value, received=Number($("cashReceived").value)||0;
  if(method==="Tunai"&&received<total){toast("Uang diterima belum mencukupi.",true);$("cashReceived").focus();return;}
  // A single IndexedDB transaction atomically updates all product stocks and inserts the sale.
  const saleId=uid("sale"), createdAt=nowIso();
  const sale={id:saleId,number:"KT-"+new Date().toISOString().replace(/[-:TZ.]/g,"").slice(0,14)+"-"+Math.random().toString(36).slice(2,5).toUpperCase(),createdAt,items:cart.map(x=>({...x})),total,costTotal:cart.reduce((n,x)=>n+x.qty*x.cost,0),paymentMethod:method,cashReceived:method==="Tunai"?received:null,change:method==="Tunai"?received-total:0,status:"completed",syncStatus:"pending",deviceId:await getDeviceId(),schemaVersion:1};
  try {
    await new Promise((resolve,reject)=>{
      const t=db.transaction(["products","sales"],"readwrite");
      const ps=t.objectStore("products"), ss=t.objectStore("sales");
      let pending=cart.length, failed=false;
      for(const item of cart) {
        const r=ps.get(item.productId);
        r.onsuccess=()=>{
          const p=r.result;
          if(!p||p.stock<item.qty){failed=true;t.abort();return;}
          p.stock-=item.qty;p.updatedAt=createdAt;ps.put(p);
          if(--pending===0) ss.add(sale);
        };
      }
      t.oncomplete=()=>resolve();
      t.onerror=()=>reject(t.error||new Error("Transaksi gagal"));
      t.onabort=()=>reject(new Error(failed?"Stok berubah atau tidak mencukupi. Muat ulang keranjang.":"Transaksi dibatalkan."));
    });
    cart=[];$("cashReceived").value="";await renderAll();
    toast(`Transaksi tersimpan di perangkat: ${sale.number}`);
  } catch(err) { toast(err.message||"Transaksi gagal disimpan.",true); }
}
let deviceIdPromise;
async function getDeviceId() {
  if(!deviceIdPromise) {
    deviceIdPromise=(async()=>{let meta=await getOne("meta","deviceId");if(!meta){meta={key:"deviceId",value:uid("device")};await put("meta",meta);}return meta.value;})();
  }
  return deviceIdPromise;
}
async function renderProductsTable() {
  const products=await allProducts();
  $("productsTable").innerHTML=tableHtml(["Produk","Kategori","Barcode / SKU","Modal","Harga jual","Stok","Aksi"],products.map(p=>[
    `<strong>${escapeHtml(p.name)}</strong>`,escapeHtml(p.category),escapeHtml(p.barcode||"—"),rupiah(p.cost),rupiah(p.price),`<span class="${p.stock<=p.minStock?"stock-number":""}">${p.stock}</span>`,
    `<button class="small-action" data-edit="${p.id}">Edit</button> <button class="small-action" data-stock="${p.id}">Ubah stok</button>`
  ]));
  $("productsTable").querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click",()=>editProduct(b.dataset.edit)));
  $("productsTable").querySelectorAll("[data-stock]").forEach(b=>b.addEventListener("click",()=>adjustStock(b.dataset.stock)));
}
function openProductModal(product=null) {
  $("productForm").reset();$("editProductId").value=product?.id||"";
  $("productModalTitle").textContent=product?"Edit produk":"Tambah produk";
  $("productName").value=product?.name||"";$("productCategory").value=product?.category||"";
  $("productBarcode").value=product?.barcode||"";$("productCost").value=product?.cost??"";
  $("productPrice").value=product?.price??"";$("productStock").value=product?.stock??0;
  $("productMinStock").value=product?.minStock??5;showModal("productModal");
}
async function editProduct(id) { const p=await getOne("products",id);if(p)openProductModal(p); }
async function saveProduct(event) {
  event.preventDefault();
  const id=$("editProductId").value||uid("prd"), old=await getOne("products",id);
  const name=$("productName").value.trim(), category=$("productCategory").value.trim(), barcode=$("productBarcode").value.trim();
  const cost=Number($("productCost").value),price=Number($("productPrice").value),stock=Number($("productStock").value),minStock=Number($("productMinStock").value||0);
  if(!name||!category||![cost,price,stock,minStock].every(Number.isSafeInteger)||[cost,price,stock,minStock].some(n=>n<0)){toast("Periksa nama, kategori, dan nilai angka.",true);return;}
  if(barcode){const duplicate=(await allProducts()).find(p=>p.barcode===barcode&&p.id!==id);if(duplicate){toast("Barcode sudah digunakan produk lain.",true);return;}}
  const product={id,name,category,barcode,cost,price,stock,minStock,active:true,createdAt:old?.createdAt||nowIso(),updatedAt:nowIso()};
  await put("products",product);closeModal("productModal");await renderAll();toast("Produk berhasil disimpan.");
}
async function adjustStock(id) {
  const p=await getOne("products",id);if(!p)return;
  const input=prompt(`Ubah stok ${p.name}.\nStok saat ini: ${p.stock}\nMasukkan stok baru (angka bulat):`,String(p.stock));
  if(input===null)return;const stock=Number(input);
  if(!Number.isSafeInteger(stock)||stock<0){toast("Stok harus berupa angka bulat nol atau lebih.",true);return;}
  p.stock=stock;p.updatedAt=nowIso();await put("products",p);await renderAll();toast("Stok diperbarui. Untuk produksi, gunakan penyesuaian stok dengan alasan dan audit log.");
}
async function renderTransactionsTable() {
  const q=($("transactionSearch")?.value||"").trim().toLowerCase(), sales=await allSales();
  const filtered=sales.filter(s=>!q||s.number.toLowerCase().includes(q));
  $("transactionsTable").innerHTML=tableHtml(["No. transaksi","Tanggal","Item","Pembayaran","Total","Status","Aksi"],filtered.map(s=>[
    `<strong>${escapeHtml(s.number)}</strong>`,fmtDate(s.createdAt),s.items.reduce((n,x)=>n+x.qty,0),escapeHtml(s.paymentMethod),rupiah(s.total),`<span class="${s.syncStatus==="synced"?"status-local":"status-pending"}">${s.syncStatus==="synced"?"Tersinkron":"Belum tersinkron"}</span>`,
    s.status==="completed"?`<button class="small-action" data-cancel="${s.id}">Batalkan</button>`:`<span class="pill warning">Dibatalkan</span>`
  ]));
  $("transactionsTable").querySelectorAll("[data-cancel]").forEach(b=>b.addEventListener("click",()=>cancelSale(b.dataset.cancel)));
}
async function cancelSale(id) {
  const sale=await getOne("sales",id);if(!sale||sale.status!=="completed")return;
  if(!confirm(`Batalkan transaksi ${sale.number}?\nStok akan dikembalikan ke perangkat ini. Pastikan transaksi belum diproses di sistem lain.`))return;
  try {
    await new Promise((resolve,reject)=>{
      const t=db.transaction(["sales","products"],"readwrite"), ss=t.objectStore("sales"),ps=t.objectStore("products");
      const r=ss.get(id);
      r.onsuccess=()=>{
        const current=r.result;if(!current||current.status!=="completed"){t.abort();return;}
        current.status="cancelled";current.cancelledAt=nowIso();current.syncStatus="pending";ss.put(current);
        current.items.forEach(item=>{const pr=ps.get(item.productId);pr.onsuccess=()=>{if(pr.result){const p=pr.result;p.stock+=item.qty;p.updatedAt=nowIso();ps.put(p);}};});
      };
      t.oncomplete=resolve;t.onerror=()=>reject(t.error);t.onabort=()=>reject(new Error("Pembatalan tidak dapat diproses."));
    });
    await renderAll();toast("Transaksi dibatalkan dan stok lokal dikembalikan.");
  }catch(e){toast(e.message,true);}
}
async function renderFinance() {
  const sales=(await allSales()).filter(s=>s.status==="completed"), expenses=await allExpenses();
  const omzet=sales.reduce((n,s)=>n+s.total,0),cost=sales.reduce((n,s)=>n+s.costTotal,0);
  $("financeOmzet").textContent=rupiah(omzet);$("financeCost").textContent=rupiah(cost);$("financeProfit").textContent=rupiah(omzet-cost);
  $("expensesTable").innerHTML=tableHtml(["Tanggal","Keterangan","Nominal","Aksi"],expenses.map(e=>[fmtDate(e.date,false),escapeHtml(e.name),rupiah(e.amount),`<button class="small-action" data-delete-expense="${e.id}">Hapus</button>`]));
  $("expensesTable").querySelectorAll("[data-delete-expense]").forEach(b=>b.addEventListener("click",async()=>{if(confirm("Hapus catatan pengeluaran ini?")){await del("expenses",b.dataset.deleteExpense);await renderAll();toast("Catatan pengeluaran dihapus.");}}));
}
async function renderReports() {
  const sales=(await allSales()).filter(s=>s.status==="completed"), products=await allProducts();
  $("reportCount").textContent=sales.length;$("reportSales").textContent=rupiah(sales.reduce((n,s)=>n+s.total,0));
  $("reportQueue").textContent=(await getAll("sales")).filter(s=>s.syncStatus!=="synced").length;
  const totals={};
  sales.forEach(s=>s.items.forEach(i=>{if(!totals[i.productId])totals[i.productId]={name:i.name,qty:0,total:0};totals[i.productId].qty+=i.qty;totals[i.productId].total+=i.qty*i.price;}));
  $("productReportTable").innerHTML=tableHtml(["Produk","Jumlah terjual","Nilai penjualan"],Object.values(totals).sort((a,b)=>b.qty-a.qty).map(x=>[escapeHtml(x.name),x.qty,rupiah(x.total)]));
}
function csvDownload(filename, rows) {
  const csv=rows.map(row=>row.map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(",")).join("\r\n");
  const blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8;"}),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
}
async function exportSales() {
  const sales=await allSales();csvDownload("faiisa-kantinku-transaksi.csv",[["Nomor","Waktu","Status","Pembayaran","Total","Estimasi modal","Status sinkronisasi"],...sales.map(s=>[s.number,s.createdAt,s.status,s.paymentMethod,s.total,s.costTotal,s.syncStatus])]);
}
async function exportReport() {
  const sales=(await allSales()).filter(s=>s.status==="completed"),products=await allProducts();
  const rows=[["Produk","Jumlah terjual","Nilai penjualan","Estimasi modal"]];
  const totals={};sales.forEach(s=>s.items.forEach(i=>{if(!totals[i.productId])totals[i.productId]={name:i.name,qty:0,total:0,cost:0};totals[i.productId].qty+=i.qty;totals[i.productId].total+=i.qty*i.price;totals[i.productId].cost+=i.qty*i.cost;}));
  Object.values(totals).forEach(x=>rows.push([x.name,x.qty,x.total,x.cost]));
  rows.push([]);rows.push(["Total transaksi",sales.length]);rows.push(["Omzet",sales.reduce((n,s)=>n+s.total,0)]);
  csvDownload("faiisa-kantinku-laporan.csv",rows);
}
async function addExpense(event) {
  event.preventDefault();const name=$("expenseName").value.trim(),amount=Number($("expenseAmount").value),date=$("expenseDate").value;
  if(!name||!Number.isSafeInteger(amount)||amount<=0||!date){toast("Lengkapi data pengeluaran.",true);return;}
  await put("expenses",{id:uid("exp"),name,amount,date,createdAt:nowIso()});closeModal("expenseModal");$("expenseForm").reset();await renderAll();toast("Pengeluaran dicatat.");
}
async function updateCanteenName() {
  const value=$("canteenName").value.trim();if(!value){toast("Nama kantin tidak boleh kosong.",true);return;}
  await put("meta",{key:"canteenName",value});toast("Nama kantin disimpan pada perangkat ini.");
}
async function backupJson() {
  const data={exportedAt:nowIso(),products:await getAll("products"),sales:await getAll("sales"),expenses:await getAll("expenses"),meta:await getAll("meta")};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"}),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download="faiisa-kantinku-backup.json";a.click();URL.revokeObjectURL(url);toast("Cadangan JSON diunduh.");
}
async function resetLocalData() {
  if(!confirm("Reset seluruh produk, transaksi, pengeluaran, dan pengaturan lokal? Tindakan ini tidak dapat dibatalkan. Unduh cadangan terlebih dahulu jika diperlukan."))return;
  for(const store of STORES)await clearStore(store);
  cart=[];await seedDemoIfEmpty();await renderAll();toast("Data lokal direset ke data contoh.");
}
async function findBarcode(value) {
  const code=value.trim();if(!code)return;
  const products=await allProducts(),p=products.find(x=>x.barcode===code);
  if(p){await addToCart(p.id);$("manualBarcode").value="";closeModal("scanModal");}
  else {toast("Barcode tidak ditemukan. Tambahkan barcode pada menu Produk & Stok.",true);}
}
async function startCamera() {
  if(!navigator.mediaDevices?.getUserMedia){$("scanHelp").textContent="Browser tidak mendukung akses kamera. Gunakan kolom barcode manual atau scanner USB.";return;}
  if(!("BarcodeDetector" in window)){ $("scanHelp").textContent="Pemindai barcode kamera belum didukung browser ini. Gunakan input manual atau scanner USB.";return; }
  try {
    barcodeDetector=new BarcodeDetector({formats:["ean_13","ean_8","upc_a","upc_e","code_128","code_39","qr_code"]});
    scanStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}},audio:false});
    $("scanVideo").srcObject=scanStream;$("scanVideo").classList.add("active");await $("scanVideo").play();$("scanHelp").textContent="Kamera aktif. Arahkan ke barcode produk.";scanLoop=true;scanFrame();
  }catch(e){$("scanHelp").textContent="Kamera tidak dapat dibuka. Pastikan izin kamera diberikan dan situs menggunakan HTTPS.";toast("Kamera gagal diaktifkan.",true);}
}
async function scanFrame() {
  if(!scanLoop||!barcodeDetector)return;
  try {const codes=await barcodeDetector.detect($("scanVideo"));if(codes.length&&codes[0].rawValue){scanLoop=false;await findBarcode(codes[0].rawValue);return;}}catch(e){}
  requestAnimationFrame(scanFrame);
}
function stopCamera() {
  scanLoop=false;if(scanStream){scanStream.getTracks().forEach(t=>t.stop());scanStream=null;}
  $("scanVideo").pause();$("scanVideo").srcObject=null;$("scanVideo").classList.remove("active");
}
function wireEvents() {
  $("nav").addEventListener("click",e=>{const b=e.target.closest("[data-page]");if(b)navigate(b.dataset.page);});
  document.querySelectorAll("[data-goto]").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.goto)));
  document.querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click",()=>closeModal(b.dataset.close)));
  document.querySelectorAll(".modal-backdrop").forEach(m=>m.addEventListener("click",e=>{if(e.target===m)closeModal(m.id);}));
  $("mobileMenu").addEventListener("click",()=>$("sidebar").classList.toggle("open"));
  $("productSearch").addEventListener("input",renderCashierProducts);$("categoryFilter").addEventListener("change",renderCashierProducts);
  $("cashReceived").addEventListener("input",renderCart);$("paymentMethod").addEventListener("change",renderCart);
  $("clearCart").addEventListener("click",()=>{cart=[];renderCart();});
  $("completeSale").addEventListener("click",completeSale);
  $("addProductBtn").addEventListener("click",()=>openProductModal());$("productForm").addEventListener("submit",saveProduct);
  $("transactionSearch").addEventListener("input",renderTransactionsTable);
  $("exportTransactions").addEventListener("click",exportSales);$("exportReport").addEventListener("click",exportReport);
  $("addExpenseBtn").addEventListener("click",()=>{ $("expenseDate").value=todayKey();showModal("expenseModal");});
  $("expenseForm").addEventListener("submit",addExpense);$("saveSettings").addEventListener("click",updateCanteenName);
  $("downloadBackup").addEventListener("click",backupJson);$("resetDemo").addEventListener("click",resetLocalData);
  $("scanOpen").addEventListener("click",()=>{showModal("scanModal");$("manualBarcode").focus();});
  $("startCamera").addEventListener("click",startCamera);
  $("manualBarcodeForm").addEventListener("submit",e=>{e.preventDefault();findBarcode($("manualBarcode").value);});
  $("syncBtn").addEventListener("click",()=>toast(navigator.onLine?"Internet tersedia, tetapi Firebase belum dikonfigurasi. Data masih lokal.":"Sedang offline. Transaksi tersimpan di perangkat.",!navigator.onLine));
  window.addEventListener("online",updateConnection);window.addEventListener("offline",updateConnection);
  // Barcode scanner USB usually behaves like a keyboard and ends with Enter.
  document.addEventListener("keydown",e=>{
    if(e.key==="Enter"&&document.activeElement.tagName!=="INPUT"&&document.activeElement.tagName!=="TEXTAREA"&&activePage==="kasir"){
      // Avoid intercepting unrelated keyboard actions; scanner integration can be enabled via manual field.
    }
  });
}
async function init() {
  $("todayText").textContent=new Date().toLocaleDateString("id-ID",{weekday:"short",day:"numeric",month:"short",year:"numeric"});
  $("expenseDate").value=todayKey();
  try {db=await openDb();await seedDemoIfEmpty();const name=await getOne("meta","canteenName");if(name)$("canteenName").value=name.value;wireEvents();await renderAll();}
  catch(e){console.error(e);toast("Database lokal tidak dapat dibuka. Gunakan browser modern dengan IndexedDB aktif.",true);}
  if("serviceWorker" in navigator && location.protocol.startsWith("http"))navigator.serviceWorker.register("./sw.js").catch(e=>console.warn("SW registration failed",e));
}
init();
