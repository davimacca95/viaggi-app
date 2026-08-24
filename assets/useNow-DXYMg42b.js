import{r as i}from"./index-CgtuLfc4.js";function a(e=3e4){const[o,s]=i.useState(()=>new Date);return i.useEffect(()=>{const t=()=>s(new Date),r=setInterval(t,e),n=()=>{document.hidden||t()};return document.addEventListener("visibilitychange",n),()=>{clearInterval(r),document.removeEventListener("visibilitychange",n)}},[e]),o}export{a as u};
//# sourceMappingURL=useNow-DXYMg42b.js.map
