const button=document.querySelector('#run'),status=document.querySelector('#status'),output=document.querySelector('#output'),summary=document.querySelector('#summary')
const root=new URL(`${import.meta.env.BASE_URL}data/`,location.origin).href
const median=values=>{const a=[...values].sort((x,y)=>x-y);return (a[2]+a[3])/2}
button.onclick=async()=>{
  button.disabled=true;summary.replaceChildren();output.textContent=''
  const results=[]
  try{
    for(let round=0;round<6;round++) for(const step of round%2?[25,24]:[24,25]) {
      status.textContent=`Сравнение ${round+1}/6, шаг ${step}…`
      const result=await new Promise((resolve,reject)=>{
        const worker=new Worker(new URL('./runtimeComparison.worker.js',import.meta.url),{type:'module'})
        const timer=setTimeout(()=>{worker.terminate();reject(Error('Превышено время ожидания Worker'))},60000)
        worker.onmessage=event=>{clearTimeout(timer);worker.terminate();event.data.error?reject(Error(event.data.error)):resolve(event.data)}
        worker.onerror=event=>{clearTimeout(timer);worker.terminate();reject(Error(event.message))}
        worker.postMessage({step,round:round+1,root})
      })
      results.push(result)
      output.textContent=JSON.stringify(results,null,2)
    }
    if(new Set(results.map(r=>r.sha)).size!==1) throw Error('Результаты выборок не совпадают')
    const table=document.createElement('table')
    const header=table.insertRow()
    for(const title of ['Этап, мс (медиана)','Шаг 24','Шаг 25']){const th=document.createElement('th');th.textContent=title;header.append(th)}
    for(const [key,title] of [['siteDecode','Декодирование площадок'],['groupDecode','Декодирование групп'],['coldIndex','Индексы: первый вызов'],['coldAnalytics','Аналитика: первый вызов'],['warmIndex','Индексы: повторные'],['warmAnalytics','Аналитика: повторные']]){
      const row=table.insertRow();row.insertCell().textContent=title
      for(const step of [24,25]) row.insertCell().textContent=String(median(results.filter(r=>r.step===step).map(r=>r[key])))
    }
    summary.append(table)
    status.textContent='Готово. Все 12 выборок совпали по SHA-256. Скопируй таблицу и результаты ниже.'
    console.table(results.map(result=>Object.fromEntries(Object.entries(result).filter(([key])=>key!=='sha'))))
  }catch(error){status.textContent=error.message}
  finally{button.disabled=false}
}
