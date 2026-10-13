const test=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {buildSync}=require('esbuild');
const {mkdtempSync}=require('node:fs');
const {join}=require('node:path');
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost:5173'});
global.window=dom.window;global.document=dom.window.document;global.HTMLElement=dom.window.HTMLElement;global.IS_REACT_ACT_ENVIRONMENT=true;
const React=require('react');
const {render,screen,fireEvent,waitFor,cleanup,act}=require('@testing-library/react');
const directory=mkdtempSync(join(__dirname,'../node_modules/.whispr-ui-test-'));
buildSync({entryPoints:[join(__dirname,'../src/App.jsx')],bundle:true,platform:'node',format:'cjs',outfile:join(directory,'app.cjs'),external:['react','react-dom'],jsx:'automatic',logOverride:{'empty-import-meta':'silent'}});
const App=require(join(directory,'app.cjs')).default;
const user={id:'owner-id',role:'owner',email:'owner@example.test',name:'Owner'};
function clientFor(identity) {let failure;return {async getCurrentUser(){if(!identity)throw Object.assign(new Error('Sign in required'),{status:401});return {user:identity,csrfToken:'csrf'};},onAuthFailure(fn){failure=fn;return()=>{};},expire(){failure?.();},async getTranscript(){return {id:1,text:'private old transcript',mode:'exact'};},async getStats(){return {totalWords:3,totalDurationSeconds:1,sessionCount:1,successRate:100};},async listUsers(){return [user,{id:'bob-id',name:'Bob',email:'bob@example.test',role:'user',disabled:false}];},async logout(){},async disableUser(){throw new Error('Unable to disable account');}};}
test('signed-out users see Google login without private data',async()=>{
 try {render(React.createElement(App,{client:clientFor(null)}));await screen.findByRole('link',{name:'Sign in with Google'});assert.equal(screen.queryByText('private old transcript'),null);}finally{cleanup();}
});
test('owner sees user controls and logout clears private UI',async()=>{
 try {const client=clientFor(user);render(React.createElement(App,{client}));await screen.findAllByText('owner@example.test');await screen.findByDisplayValue('private old transcript');await screen.findByText('bob@example.test');fireEvent.click(screen.getByRole('button',{name:'Sign out'}));await screen.findByRole('link',{name:'Sign in with Google'});assert.equal(screen.queryByText('bob@example.test'),null);assert.equal(screen.queryByDisplayValue('private old transcript'),null);}finally{cleanup();}
});
test('regular users have no owner controls and session expiry removes their data',async()=>{
 try {const client=clientFor({...user,id:'bob',role:'user'});render(React.createElement(App,{client}));await screen.findAllByText('owner@example.test');await screen.findByDisplayValue('private old transcript');assert.equal(screen.queryByRole('heading',{name:'Manage users'}),null);await act(async()=>client.expire());await waitFor(()=>assert.ok(screen.getByRole('link',{name:'Sign in with Google'})));assert.equal(screen.queryByDisplayValue('private old transcript'),null);}finally{cleanup();}
});

test('failed user disable is reported without claiming success',async()=>{
 try {window.confirm=()=>true;render(React.createElement(App,{client:clientFor(user)}));await screen.findByText('bob@example.test');fireEvent.click(screen.getByRole('button',{name:'Disable'}));await screen.findByRole('alert');assert.match(screen.getByRole('alert').textContent,/Unable to disable/);assert.ok(screen.getByRole('button',{name:'Disable'}));}finally{cleanup();}
});

test('desktop browser approval requires an explicit click and survives Google redirect',async()=>{
 let approvals=0;
 try {
  const id='11111111-1111-4111-8111-111111111111';
  window.history.replaceState({},'',`/?pairing=${id}`);
  render(React.createElement(App,{client:clientFor(null)}));await screen.findByRole('link',{name:'Sign in with Google'});cleanup();
  window.history.replaceState({},'','/');
  const client=clientFor(user);client.getPairing=async()=>({pairingId:id,appName:'Whispr desktop'});client.approvePairing=async value=>{assert.equal(value,id);approvals++;};
  render(React.createElement(App,{client}));await screen.findByRole('button',{name:'Approve Whispr desktop'});
  assert.equal(approvals,0);fireEvent.click(screen.getByRole('button',{name:'Approve Whispr desktop'}));
  await screen.findByText('Desktop approved. You can return to Whispr.');assert.equal(approvals,1);assert.equal(window.sessionStorage.getItem('whisprPairing'),null);
 }finally{cleanup();window.sessionStorage.clear();window.history.replaceState({},'','/');}
});
