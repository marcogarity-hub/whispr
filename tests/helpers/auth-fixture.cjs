const userId='11111111-1111-4111-8111-111111111111';
const token='x'.repeat(43);
const authOptions={authStore:{async resolveSession(value){return value===token?{kind:'desktop',user:{id:userId,role:'user'},csrfToken:'test-csrf'}:null;}},google:{},appOrigin:'http://localhost:5173'};
module.exports={userId,authorization:`Bearer ${token}`,authOptions};
