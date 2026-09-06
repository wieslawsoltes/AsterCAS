import {Kernel} from './core/kernel.js';
const kernel=new Kernel();
self.onmessage=event=>{
  const {id,cells,reset=true}=event.data;
  if(reset)kernel.reset();
  for(const cell of cells){
    if(!cell.source.trim())continue;
    try {const result=kernel.run(cell.source);self.postMessage({id,cellId:cell.id,result});}
    catch(error){self.postMessage({id,cellId:cell.id,result:{kind:'error',plain:error.message,position:error.position??-1,environment:kernel.environment()}});}
  }
  self.postMessage({id,done:true,environment:kernel.environment()});
};
