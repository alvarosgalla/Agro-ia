/* Autenticación real. La contraseña solo se envía a Supabase por HTTPS. */
let agroClient, agroUser, authBusy=false, marketBusy=false;
const cfg=window.AGRO_CONFIG||{};
function authMessage(message){document.getElementById('authStatus').textContent=message;}
function requireAuthClient(){if(!agroClient)throw Error('Falta configurar el servicio de usuarios.');return agroClient;}
function lockApp(){agroUser=null;window.AGRO_USER_ID=null;document.querySelector('.app').style.display='none';document.getElementById('loginScreen').style.display='flex';}
function activateUser(user){
  if(!user?.email_confirmed_at){lockApp();authMessage('Confirmá tu correo para ingresar.');return;}
  agroUser=user;window.AGRO_USER_ID=user.id;saveProfile({name:user.user_metadata?.name||user.email,email:user.email,specialties:user.user_metadata?.specialties||[]});
  enterApp();renderLots();renderSoilLots();document.getElementById('sessionEmail').textContent=user.email;
  refreshAFAMarkets();
}
async function authAction(action){if(authBusy)return;authBusy=true;authMessage('Procesando…');try{await action();}catch(e){authMessage(e.message==='Invalid login credentials'?'Correo o contraseña incorrectos.':e.message==='Email not confirmed'?'Confirmá el correo desde el enlace recibido.':e.message);}finally{authBusy=false;}}
window.registerUser=()=>authAction(async()=>{
  const email=document.getElementById('regEmail').value.trim(),password=document.getElementById('regPassword').value,name=document.getElementById('regName').value.trim(),specialties=getSelectedSpecialties();
  if(!name||!/^\S+@\S+\.\S+$/.test(email)||password.length<8||!specialties.length)throw Error('Completá nombre, correo válido, contraseña de 8 caracteres y una actividad.');
  const {data,error}=await requireAuthClient().auth.signUp({email,password,options:{emailRedirectTo:location.origin+location.pathname,data:{name,specialties}}});if(error)throw error;
  document.getElementById('regPassword').value='';switchAuth('login');
  authMessage('Revisá tu correo y confirmá la cuenta antes de ingresar.');
  if(data.session)activateUser(data.session.user);
});
window.loginUser=()=>authAction(async()=>{
  const {data,error}=await requireAuthClient().auth.signInWithPassword({email:document.getElementById('loginEmail').value.trim(),password:document.getElementById('loginPassword').value});if(error)throw error;
  document.getElementById('loginPassword').value='';activateUser(data.user);
});
window.logoutUser=async()=>{lockApp();try{const {error}=await requireAuthClient().auth.signOut();if(error)throw error;}catch(e){authMessage(e.message);}};
window.recoverPassword=()=>authAction(async()=>{
  const email=document.getElementById('loginEmail').value.trim();if(!/^\S+@\S+\.\S+$/.test(email))throw Error('Ingresá tu correo en el formulario.');
  const {error}=await requireAuthClient().auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});if(error)throw error;
  authMessage('Si existe una cuenta, recibirás un enlace para cambiar la contraseña.');
});
window.updateRecoveredPassword=()=>authAction(async()=>{
  const password=document.getElementById('newPassword').value;if(password.length<8)throw Error('Usá al menos 8 caracteres.');
  const {error}=await requireAuthClient().auth.updateUser({password});if(error)throw error;
  document.getElementById('newPassword').value='';document.getElementById('recoveryPanel').hidden=true;
  await logoutUser();authMessage('Contraseña actualizada. Iniciá sesión.');
});
window.saveProfileFromPage=async()=>{
  try{const specialties=[...document.querySelectorAll('#profileSpecialties input:checked')].map(x=>x.value);if(!specialties.length)throw Error('Seleccioná una actividad.');
  const {data,error}=await requireAuthClient().auth.updateUser({data:{specialties}});if(error)throw error;activateUser(data.user);alert('Perfil actualizado.');}catch(e){alert(e.message);}
};
async function agroRequest(path,body){
  if(!cfg.apiBase)throw Error('Falta configurar el servidor de AgroIA.');
  const {data,error}=await requireAuthClient().auth.getSession();if(error)throw error;if(!data.session)throw Error('Iniciá sesión nuevamente.');
  const response=await fetch(cfg.apiBase.replace(/\/$/,'')+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+data.session.access_token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(75000)});
  const result=await response.json();if(!response.ok)throw Error(result.error||'No se pudo conectar.');return result;
}
window.askAgroAI=async()=>{
  const box=document.getElementById('aiAnswer'),button=document.getElementById('agroAskButton'),question=document.getElementById('aiQuestion').value.trim();if(!question||button.disabled)return;
  box.style.display='block';box.style.whiteSpace='pre-wrap';box.textContent='AgroIA está analizando…';button.disabled=true;
  try{const context={specialties:getProfile().specialties,lots:getLots().map(l=>({...l,isDemo:[910001,910002,910003,910004,910005].includes(l.id)})),soilSamples:readSoils()};
  box.textContent=(await agroRequest('/api/agroia',{question,context})).answer;}catch(e){box.textContent=e.message;}finally{button.disabled=false;}
};
window.refreshAFAMarkets=async()=>{
  if(marketBusy)return;marketBusy=true;
  const box=document.getElementById('afaMarkets'),status=document.getElementById('afaMarketStatus');status.textContent='Consultando AFA…';box.replaceChildren();
  try{const data=await agroRequest('/api/markets');
    const renderTable=(title,headers,rows)=>{const card=document.createElement('div');card.className='card section';card.style.overflowX='auto';const h=document.createElement('h3');h.textContent=title;card.append(h);const table=document.createElement('table');const head=document.createElement('thead'),tr=document.createElement('tr');headers.forEach(v=>{const cell=document.createElement('th');cell.textContent=v;tr.append(cell);});head.append(tr);table.append(head);const body=document.createElement('tbody');rows.forEach(row=>{const r=document.createElement('tr');row.forEach(value=>{const cell=document.createElement('td');cell.textContent=value;r.append(cell);});body.append(r);});table.append(body);card.append(table);box.append(card);};
    renderTable('Precios publicados por AFA · ARS/t',['Cultivo','Destino','Precio','Fecha'],data.spot.map(p=>[p.crop,p.destination,new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS'}).format(p.price),p.date]));
    data.tables.forEach(t=>renderTable(t.title+' · '+t.updated,/CBOT/.test(t.title)?['Producto','Posición','Diferencia USD','Último']: /Agropecuario/.test(t.title)?['Producto','Compra','Último','Venta','Ajuste']:['Fecha','Producto','Último','Variación','Diferencia'],t.rows));
    status.textContent='Consultado: '+new Date(data.fetchedAt).toLocaleString('es-AR')+'. Cada tabla conserva la fecha y demora de AFA. Valores cero se muestran tal como aparecen en la fuente.';
  }catch(e){status.textContent=e.message+' Podés consultar la página de AFA con el enlace.';}finally{marketBusy=false;}
};
window.addEventListener('load',async()=>{
  lockApp();localStorage.removeItem('agroia_logged');localStorage.removeItem('agroia_profile');
  if(!cfg.supabaseUrl||!cfg.supabasePublicKey||!window.supabase){authMessage('El inicio de sesión está preparado. Falta configurar Supabase para activarlo.');return;}
  agroClient=supabase.createClient(cfg.supabaseUrl,cfg.supabasePublicKey);
  let recovering=false;
  agroClient.auth.onAuthStateChange((event,session)=>{
    if(event==='PASSWORD_RECOVERY'){recovering=true;lockApp();document.getElementById('recoveryPanel').hidden=false;authMessage('Elegí una nueva contraseña.');return;}
    if(event==='SIGNED_OUT'){lockApp();return;}
    if(session&&!recovering)activateUser(session.user);
  });
  const {data,error}=await agroClient.auth.getUser();if(data.user&&!recovering)activateUser(data.user);else if(error)authMessage('Ingresá con tu cuenta o creá una nueva.');
});
