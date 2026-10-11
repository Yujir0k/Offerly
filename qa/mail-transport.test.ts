import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import {sendAccountMail} from '../lib/mail-transport';
const original=nodemailer.createTransport;
after(()=>{nodemailer.createTransport=original;});
process.env.SMTP_HOST='smtp.example.test';process.env.SMTP_PORT='465';process.env.MAIL_FROM='Офферли <noreply@example.test>';
const message={to:'own@example.test',subject:'Test',text:'Test'};
test('SMTP retries a failed connection once before submission and disables file/URL access',async()=>{
 let calls=0,closed=0;
 nodemailer.createTransport=(()=>({sendMail:async(m: import("nodemailer").SendMailOptions)=>{assert(m.disableFileAccess&&m.disableUrlAccess);if(++calls===1)throw Object.assign(new Error('timeout'),{code:'ETIMEDOUT',command:'CONN'});return{accepted:['own@example.test'],rejected:[]};},close:()=>closed++})) as unknown as typeof nodemailer.createTransport;
 await sendAccountMail(message);assert.equal(calls,2);assert.equal(closed,1);
});
test('SMTP never repeats a timeout after DATA or an authentication rejection',async()=>{
 for(const command of ['DATA','AUTH']){
  let calls=0,closed=0;
  nodemailer.createTransport=(()=>({sendMail:async()=>{calls++;throw Object.assign(new Error('failure'),{code:'ETIMEDOUT',command});},close:()=>closed++})) as unknown as typeof nodemailer.createTransport;
  await assert.rejects(sendAccountMail(message));assert.equal(calls,1);assert.equal(closed,1);
 }
});
