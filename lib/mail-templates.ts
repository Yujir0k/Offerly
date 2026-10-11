import "server-only";
import { mailMarkHtml } from "./mail-mark";
import type { AccountMail } from "./mail-transport";
import type { Invitation } from "./model";

export type CodeMailKind = "verify" | "change-old" | "change-new" | "recovery";
const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g,
  char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]!));
const copies = {
  verify: {subject:"Офферли: код подтверждения",eyebrow:"РАДЫ ЗНАКОМСТВУ",title:"Дело начинается<br>со знакомства.",body:"Подтвердите почту, чтобы продолжить регистрацию в Офферли.",label:"Ваш код подтверждения",notice:"Если вы не регистрировались в Офферли, просто проигнорируйте это письмо."},
  "change-old": {subject:"Офферли: подтвердите смену почты",eyebrow:"НАСТРОЙКИ АККАУНТА",title:"Подтвердите доступ<br>к вашей почте.",body:"Введите код в настройках Офферли, чтобы подтвердить доступ к текущему адресу. Затем мы проверим новую почту.",label:"Код для текущей почты",notice:"Если вы не запрашивали смену почты, не передавайте код другим людям. Адрес не изменится без подтверждения новой почты."},
  "change-new": {subject:"Офферли: подтвердите новый адрес",eyebrow:"НАСТРОЙКИ АККАУНТА",title:"Новая почта.<br>Всё ваше — с вами.",body:"Введите код в настройках Офферли, чтобы подтвердить новый адрес почты аккаунта.",label:"Код для новой почты",notice:"Если вы не запрашивали смену почты, просто проигнорируйте это письмо."},
  recovery: {subject:"Офферли: восстановление пароля",eyebrow:"ДОСТУП К АККАУНТУ",title:"Вернём вас<br>к вашему делу.",body:"Введите этот код в окне восстановления, затем задайте новый пароль.",label:"Код восстановления",notice:"Если вы не запрашивали восстановление, проигнорируйте письмо. Ваш пароль не изменится."},
};
export function mailOrigin() {
  const url = new URL(process.env.APP_URL || "http://localhost:5174");
  if (url.username || url.password || !["http:","https:"].includes(url.protocol) ||
      (process.env.NODE_ENV === "production" && url.protocol !== "https:"))
    throw new Error("Укажите корректный APP_URL для почты");
  return url.origin;
}
function frame(input: {eyebrow:string;title:string;body:string;content:string;notice:string;preheader:string}) {
  const origin=mailOrigin();
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>Офферли — Дело найдёт.</title><style>body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}table,td{mso-table-lspace:0;mso-table-rspace:0}table{border-spacing:0}a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important}@media only screen and (max-width:600px){.outer{padding:20px 12px!important}.pad{padding-left:24px!important;padding-right:24px!important}.title{font-size:28px!important;line-height:35px!important}.code{font-size:35px!important;letter-spacing:7px!important;padding-left:7px!important}}</style></head><body style="margin:0;padding:0;background-color:#F3F1F8;font-family:Arial,Helvetica,sans-serif;color:#1B1C21"><div style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;mso-hide:all">${escape(input.preheader)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F3F1F8"><tr><td class="outer" align="center" style="padding:40px 20px 28px"><!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0"><tr><td><![endif]--><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="width:100%;max-width:560px;border:1px solid #E8E4F0;border-radius:18px"><tr><td class="pad" bgcolor="#1B1C21" style="padding:28px 36px;border-radius:18px 18px 0 0"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="44" style="vertical-align:middle">${mailMarkHtml}</td><td style="padding-left:12px;vertical-align:middle"><div style="font-size:27px;line-height:30px;letter-spacing:-1.1px;font-weight:700;color:#FFFFFF">Офферли</div><div style="font-size:11px;line-height:18px;color:#C2BECE">Дело найдёт.</div></td></tr></table></td></tr><tr><td height="3" bgcolor="#402FFF" style="font-size:0;line-height:0;height:3px">&nbsp;</td></tr><tr><td class="pad" style="padding:30px 36px 32px"><p style="margin:0 0 14px;font-family:'Courier New',monospace;font-size:10px;line-height:16px;letter-spacing:1.5px;font-weight:700;color:#402FFF">${escape(input.eyebrow)}</p><h1 class="title" style="margin:0;font-size:32px;line-height:39px;letter-spacing:-1.1px;font-weight:700;color:#1B1C21">${input.title}</h1><p style="margin:18px 0 0;font-size:15px;line-height:24px;color:#75717F">${escape(input.body)}</p>${input.content}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px"><tr><td height="1" bgcolor="#E8E4F0" style="font-size:0;line-height:0;height:1px">&nbsp;</td></tr><tr><td style="padding-top:20px;font-size:12px;line-height:20px;color:#75717F">${escape(input.notice)}</td></tr></table></td></tr></table><!--[if mso]></td></tr></table><![endif]--><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px"><tr><td align="center" style="padding:22px 16px 0;font-size:12px;line-height:20px;color:#75717F"><a href="${escape(origin)}" style="color:#75717F;text-decoration:none;font-weight:700">Офферли · Дело найдёт.</a></td></tr></table></td></tr></table></body></html>`;
}
function finish(kind:string,to:string,subject:string,html:string,text:string):AccountMail {
  return {to,subject,html,text,headers:{"X-Offerly-Template":`signature-v1/${kind}`}};
}
export function codeMail(kind:CodeMailKind,to:string,code:string):AccountMail {
  if(!/^\d{6}$/.test(code))throw new Error("Код письма должен содержать шесть цифр");
  const c=copies[kind];
  const content=`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:26px 0 0"><tr><td bgcolor="#F2EFFF" align="center" style="padding:22px 12px 20px;border:1px solid #E3DCFF;border-radius:12px"><div style="font-size:12px;line-height:20px;color:#75717F;padding-bottom:10px">${escape(c.label)}</div><div class="code" style="font-family:'Courier New',monospace;font-size:42px;font-weight:700;line-height:50px;letter-spacing:9px;padding-left:9px;color:#402FFF;white-space:nowrap">${code}</div><div style="font-size:12px;line-height:20px;color:#75717F;padding-top:9px">Действует 10 минут</div></td></tr></table><p style="margin:20px 0 0;font-size:13px;line-height:21px;color:#75717F">Введите код на сайте. Никому его не сообщайте — даже от имени нашей команды.</p>`;
  return finish(kind,to,c.subject,frame({...c,content,preheader:`${c.label}. Код действует 10 минут.`}),
    `Офферли — Дело найдёт.\n\n${c.body}\n\n${c.label}: ${code}\nДействует 10 минут. Никому не сообщайте код.\n\n${c.notice}`);
}
export function passwordChangedMail(to:string):AccountMail {
  const body="Пароль вашего аккаунта изменён. Все входы завершены.";
  const notice="Если это сделали не вы, восстановите пароль и проверьте доступ к почте.";
  return finish("password-changed",to,"Офферли: пароль изменён",frame({eyebrow:"БЕЗОПАСНОСТЬ АККАУНТА",title:"Пароль обновлён.",body,notice,content:"",preheader:body}),`Офферли — Дело найдёт.\n\n${body}\n${notice}`);
}
export function invitationMail(to:string,invitation:Invitation):AccountMail {
  const url=new URL('/demo/candidate/invitations',mailOrigin());
  url.searchParams.set('invitation',invitation.id);
  const money=(v:number)=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(v).replaceAll('\u00a0',' ');
  const salary=`${money(invitation.min)} — ${money(invitation.max)} ₽`;
  const conditions=[invitation.format,invitation.city].filter(Boolean).join(' · ');
  const details=[invitation.grade,...(invitation.skills||[]).slice(0,8)].filter(Boolean).join(' · ');
  const subject=`Офферли: приглашение от ${invitation.company.replace(/[\r\n]/g,' ').slice(0,150)}`;
  const body=`Команда «${invitation.company}» приглашает вас познакомиться и обсудить работу.`;
  const notice="Откройте приглашение, чтобы изучить условия. Контакты станут доступны компании после вашего согласия. Письма о приглашениях можно отключить в настройках уведомлений.";
  const content=`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:26px"><tr><td bgcolor="#F6F4FC" style="padding:22px 24px;border:1px solid #E8E4F0;border-radius:12px;word-break:break-word"><div style="font-size:12px;line-height:20px;color:#75717F">${escape(invitation.company)}</div><div style="font-size:20px;font-weight:700;line-height:28px;margin-top:8px;color:#1B1C21">${escape(invitation.title)}</div>${details?`<div style="font-size:13px;line-height:22px;color:#75717F;margin-top:4px">${escape(details)}</div>`:''}<div style="font-family:Arial,sans-serif;font-size:25px;line-height:34px;font-weight:700;letter-spacing:-0.8px;margin-top:18px;color:#402FFF">${escape(salary)}</div><div style="font-size:12px;line-height:20px;color:#75717F">в месяц${conditions?` · ${escape(conditions)}`:''}</div></td></tr></table><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:22px"><tr><td align="center" bgcolor="#402FFF" style="border-radius:10px;mso-padding-alt:16px 24px"><a href="${escape(url.href)}" style="display:block;padding:16px 24px;font-size:15px;line-height:22px;font-weight:700;color:#FFFFFF;text-decoration:none;border:1px solid #402FFF;border-radius:10px">Посмотреть приглашение&nbsp; →</a></td></tr></table>`;
  return finish("invitation",to,subject,frame({eyebrow:"ВАШ ОПЫТ ЗАМЕТИЛИ",title:"Кажется, ваше<br>дело нашлось.",body,content,notice,preheader:`${invitation.company}: ${invitation.title}, ${salary} в месяц.`}),
    `Офферли — Дело найдёт.\n\n${body}\n\n${invitation.title}\n${details}\n${salary} в месяц\n${conditions}\n\nПосмотреть приглашение: ${url.href}\n\n${notice}`);
}
