const {bootstrap}=require('./bootstrap.cjs');
if(process.env.APP_ORIGIN!=='http://localhost:5173') throw new Error('Local API requires APP_ORIGIN=http://localhost:5173');
bootstrap().listen(3000,'127.0.0.1',()=>console.log('Whispr development API listening on port 3000'));
