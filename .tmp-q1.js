const D=require('better-sqlite3');
const db=new D('data/gijo-as.sqlite',{readonly:true,fileMustExist:true});
const rows=db.prepare("SELECT documentId, origin FROM memory_documents WHERE documentId NOT LIKE '승인문답:%'").all();
const re=/(LLM|RAG|가이드|설치|티어|온보딩|계획서|인계|런북)/;
const hit=rows.filter(r=>re.test(r.documentId));
console.log('전체 비-승인문답 문서', rows.length, '/ 내부문서꼴 후보', hit.length);
for(const r of hit.slice(0,40)) console.log(' -', r.documentId, '|', r.origin);
