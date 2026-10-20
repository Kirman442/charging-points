// Keep the original CARTO layout and data; only name fields use German.
const nameExpression=()=>['case',...['name_de','name:de','name','name_en'].flatMap(key=>[['!=',['coalesce',['get',key],''],''],['get',key]]),''];
export function germanTextField(field){
 if(field==null||JSON.stringify(field).includes('name_de'))return field;
 if(typeof field==='string'){
   const parts=[],pattern=/\{name(?:(?:_|:)en)?\}/g;let last=0,match;
   while((match=pattern.exec(field))){if(match.index>last)parts.push(field.slice(last,match.index));parts.push(nameExpression());last=pattern.lastIndex;}
   if(!parts.length)return field;
   if(last<field.length)parts.push(field.slice(last));
   return parts.length===1?parts[0]:['concat',...parts];
 }
 if(Array.isArray(field)){
   if(field[0]==='get'&&['name','name_en','name:en'].includes(field[1]))return nameExpression();
   return field.map(value=>germanTextField(value));
 }
 if(field.stops&&!field.property){
   const stops=field.stops;
   return ['step',['zoom'],germanTextField(stops[0][1]),...stops.slice(1).flatMap(([zoom,label])=>[zoom,germanTextField(label)])];
 }
 return field;
}
export function localizeBasemap(map){
 if(!map?.isStyleLoaded())return;
 for(const layer of map.getStyle().layers||[]){
   const field=layer.layout?.['text-field'];if(field==null)continue;
   const next=germanTextField(field);
   if(JSON.stringify(next)!==JSON.stringify(field))map.setLayoutProperty(layer.id,'text-field',next);
 }
}
