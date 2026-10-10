// #57: composição de uma cena com a ordem de camadas do VDP do Mega Drive.
// De trás para a frente: cor de fundo < B baixa < A baixa < sprites baixa <
// B alta < A alta < sprites alta. Índice 0 de qualquer padrão é transparente.
// A prioridade dos planos vale por tile (célula de 8×8); a dos sprites, por sprite.
// Entre sprites, o que vem antes na lista fica na frente, e um sprite de baixa prioridade
// que vem antes ESCONDE um de alta prioridade que vem depois (mascaramento do hardware).
/**
 * planes.a / planes.b: {width,height (pixels, múltiplos de 8), indices:Uint8Array (0–15 por pixel),
 *   palette:0–3 ou paletteByTile:Uint8Array, priority:Uint8Array (0/1 por tile) opcional, x,y opcionais}
 * sprites: [{x,y,width,height,indices,palette,priority}] na ordem da lista de sprites.
 * colors: 64 palavras do VDP. Devolve Uint16Array de palavras do VDP por pixel e, se pedido, a camada vencedora.
 */
export function composeVdp({width,height,colors,backdrop=0,planes={},sprites=[],layers=false}){
 const output=new Uint16Array(width*height),winner=layers?new Uint8Array(width*height):null
 const plane=(source,x,y)=>{
  if(!source)return null
  const px=x-(source.x||0),py=y-(source.y||0)
  if(px<0||py<0||px>=source.width||py>=source.height)return null
  const index=source.indices[py*source.width+px]
  if(!index)return null
  const tile=(py>>3)*(source.width>>3)+(px>>3)
  return {color:(source.paletteByTile?source.paletteByTile[tile]:source.palette||0)*16+index,high:!!(source.priority&&source.priority[tile])}
 }
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  // Sprite: o primeiro da lista que tem pixel opaco aqui vence os demais.
  let sprite=null
  for(const item of sprites){
   const sx=x-item.x,sy=y-item.y
   if(sx<0||sy<0||sx>=item.width||sy>=item.height)continue
   const index=item.indices[sy*item.width+sx]
   if(index){sprite={color:(item.palette||0)*16+index,high:!!item.priority};break}
  }
  const a=plane(planes.a,x,y),b=plane(planes.b,x,y)
  let color=backdrop,layer=0
  if(sprite&&sprite.high){color=sprite.color;layer=6}
  else if(a&&a.high){color=a.color;layer=5}
  else if(b&&b.high){color=b.color;layer=4}
  else if(sprite){color=sprite.color;layer=3}
  else if(a){color=a.color;layer=2}
  else if(b){color=b.color;layer=1}
  output[y*width+x]=colors[color]&0x0EEE
  if(winner)winner[y*width+x]=layer
 }
 return layers?{pixels:output,layers:winner}:output
}
export const VDP_LAYERS=Object.freeze(['backdrop','b-low','a-low','sprite-low','b-high','a-high','sprite-high'])
