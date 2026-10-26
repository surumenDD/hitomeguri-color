if(new URLSearchParams(location.search).has('capture'))document.body.classList.add('capture');
else{
  const gallery=document.querySelector('#gallery');
  for(const [id,name] of [['flat','平らな色面'],['painterly','絵画調'],['pixel','にせのドット絵'],['photo','写真調']])for(const [test,label] of [['b','最大色の色相を120度変更'],['d','2番目の色を明るくする'],['e','同じ色を空側だけ変更']]){
    const section=document.createElement('section'),heading=document.createElement('h2'),image=new Image();
    heading.textContent=`${name}：${label}`;image.src=`results/${id}-${test}.jpg`;image.alt=`${name}の試験${test}、原画と5候補の比較`;image.loading='lazy';section.append(heading,image);gallery.append(section);
  }
}
