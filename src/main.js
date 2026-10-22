import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import './style.css';

const app = document.querySelector('#app');
app.innerHTML = `
  <div id="hud"><div class="vignette"></div><div class="topbar"><div class="location">NIGHT SHIFT // SECTOR 09<strong>VOID LINE SUBSTATION</strong></div><div class="san"><div class="san-label">COGNITIVE INTEGRITY <span id="sanText">100</span>%</div><div class="san-track"><div class="san-fill" id="sanFill"></div></div></div></div><div class="crosshair"></div><div class="prompt" id="prompt">[ E ] INTERACT</div><div class="objective"><span>ACTIVE DIRECTIVE</span><strong id="objective">Recover the 3 memory cores</strong></div><div class="status"><span>CHARGE <b id="battery">100%</b></span><span id="flashlightState">FLASHLIGHT OFF</span></div><div class="damage" id="damage"></div><div id="flash"></div><div id="mobile"><button class="touch" id="moveStick">MOVE</button><button class="touch" id="flashlightButton">LIGHT</button><button class="touch" id="actionButton">USE</button></div></div>
  <div class="overlay" id="overlay"><div class="title-noise"></div><div class="panel"><div class="kicker">NIGHT SHIFT 03:14 // SURVIVE THE FEED</div><h1>NEON<em>DISTRICT 9</em></h1><p class="intro">The blackout swallowed Relay Station Theta. Recover its stolen memory cores before the maintenance construct finds you. You are not alone beneath the city.</p><div class="instructions"><div><span class="key">WASD</span> Move</div><div><span class="key">MOUSE</span> Look</div><div><span class="key">SHIFT</span> Run</div><div><span class="key">F</span> Flashlight</div><div><span class="key">E</span> Interact</div></div><button id="start">ENTER THE STATION</button></div></div>`;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020405);
scene.fog = new THREE.FogExp2(0x020405, 0.065);
const camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.05, 80);
camera.rotation.order = 'YXZ';
scene.add(camera);

const renderer = new THREE.WebGLRenderer({ antialias:true, powerPreference:'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
app.prepend(renderer.domElement);

const post = new EffectComposer(renderer);
post.addPass(new RenderPass(scene,camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth,innerHeight), .48, .72, .82);
post.addPass(bloom);
const finishShader = {
  uniforms:{ tDiffuse:{value:null}, time:{value:0}, resolution:{value:new THREE.Vector2(innerWidth,innerHeight)} },
  vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
  fragmentShader:`
    uniform sampler2D tDiffuse; uniform float time; uniform vec2 resolution; varying vec2 vUv;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    void main(){
      vec2 uv=vUv;
      vec2 centered=uv-.5;
      float edge=smoothstep(.18,.72,length(centered));
      uv+=(centered*edge*edge*.018);
      float scan=.985+.015*sin(uv.y*resolution.y*1.35);
      vec3 color=texture2D(tDiffuse,uv).rgb;
      float grain=(hash(uv*resolution+floor(time*18.0))-.5)*.026;
      float noise=(hash(uv+time*.11)-.5)*.006;
      color+=grain+noise;
      color*=scan;
      color=mix(color,vec3(dot(color,vec3(.299,.587,.114))),.12);
      color*=1.0-edge*.17;
      gl_FragColor=vec4(color,1.0);
    }`
};
const finishPass=new ShaderPass(finishShader); post.addPass(finishPass); post.addPass(new OutputPass());

const clock = new THREE.Clock();
const keys = {};
const colliders = [];
const interactables = [];
let yaw = 0, pitch = 0, started = false, ended = false, sanity = 100, battery = 100;
let cores = 0, enemies = [], flashlightOn = false, walkPhase = 0, isMoving = false;
const player = new THREE.Object3D();
player.position.set(0, 1.65, 17);
scene.add(player);

const mat = (color, rough=.8, emissive=0) => new THREE.MeshStandardMaterial({color, roughness:rough, metalness:.35, emissive, emissiveIntensity:emissive ? 2 : 0});
const black = mat(0x0b1012), wallMat = mat(0x162024), metal = mat(0x263337);
const cyan = 0x55f5df, red = 0xff3158;
const dustGeometry=new THREE.BufferGeometry();
const dustCount=620;
const dustPositions=new Float32Array(dustCount*3);
for(let i=0;i<dustCount;i++){dustPositions[i*3]=(Math.random()-.5)*19;dustPositions[i*3+1]=.2+Math.random()*3.45;dustPositions[i*3+2]=(Math.random()-.5)*41;}
dustGeometry.setAttribute('position',new THREE.BufferAttribute(dustPositions,3));
const dust=new THREE.Points(dustGeometry,new THREE.PointsMaterial({color:0x9fb9b4,size:.018,transparent:true,opacity:.26,depthWrite:false,sizeAttenuation:true}));
scene.add(dust);
const flashlight = new THREE.SpotLight(0xf0fff9, 84, 38, Math.PI / 8.5, .48, 1.02);
const flashlightTarget = new THREE.Object3D();
flashlight.position.set(.22, -.12, 0);
flashlight.target = flashlightTarget;
flashlight.castShadow = true;
flashlight.shadow.bias = -.00018;
flashlight.shadow.normalBias = .025;
flashlight.shadow.mapSize.set(innerWidth > 900 ? 2048 : 1024, innerWidth > 900 ? 2048 : 1024);
flashlight.visible = false;
camera.add(flashlight, flashlightTarget);
flashlightTarget.position.set(0, -.08, -1);

function toggleFlashlight() {
  if(!started || ended) return;
  flashlightOn = !flashlightOn && battery > 0;
  flashlight.visible = flashlightOn;
  document.querySelector('#flashlightState').textContent = flashlightOn ? 'FLASHLIGHT ON' : 'FLASHLIGHT OFF';
}

function box(name, size, pos, material, collide=true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  m.name=name; m.position.set(...pos); m.receiveShadow=true; m.castShadow=true; scene.add(m);
  if (collide) colliders.push(new THREE.Box3().setFromObject(m));
  return m;
}

function addLight(color, intensity, pos, distance=14) {
  const l = new THREE.PointLight(color, intensity, distance, 1.7); l.position.set(...pos); scene.add(l); return l;
}

function buildStation() {
  const reflectionQuality = Math.min(innerWidth, innerHeight) > 900 ? 1024 : 512;
  const floor = new Reflector(new THREE.PlaneGeometry(20,42), {
    clipBias:0.003,
    textureWidth:reflectionQuality,
    textureHeight:reflectionQuality,
    color:0x1a2325
  });
  floor.name='reflective floor';
  floor.rotation.x=-Math.PI/2;
  floor.position.y=.008;
  floor.receiveShadow=true;
  scene.add(floor);
  box('floor',[20,.2,42],[0,-.1,0],mat(0x111719),false);
  box('ceiling',[20,.2,42],[0,4,-0],black,false);
  box('north wall',[20,4,.35],[0,2,-21],wallMat,false);
  box('south wall',[20,4,.35],[0,2,21],wallMat,false);
  box('west wall',[.35,4,42],[-10,2,0],wallMat,false);
  box('east wall',[.35,4,42],[10,2,0],wallMat,false);

  for (let z=-18; z<=18; z+=4) {
    box('floor seam',[.025,.006,42],[0,.012,z],mat(0x263133),false);
    box('wall rib',[.2,4,.18],[-9.82,2,z],mat(0x334247),false);
  }
  for (let z=-16; z<=16; z+=8) box('ceiling cable',[.06,.06,8],[7.5,3.82,z],mat(0x080909),false);

  const pipeMaterial=mat(0x394447,.34,.04);
  const pipeDark=mat(0x11191b,.48);
  const pipeAmber=mat(0x98652b,.38,.08);
  const pipeCyan=mat(0x176b68,.32,.12);
  const pipeGeometry=new THREE.CylinderGeometry(1,1,1,12);
  const bandGeometry=new THREE.CylinderGeometry(1.09,1.09,.07,12);
  const addPipe=(start,end,radius,material,bands=[])=>{
    const from=new THREE.Vector3(...start), to=new THREE.Vector3(...end);
    const direction=to.clone().sub(from);
    const length=direction.length();
    const center=from.add(to).multiplyScalar(.5);
    const rotation=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize());
    const pipe=new THREE.Mesh(pipeGeometry,material);
    pipe.position.copy(center); pipe.quaternion.copy(rotation); pipe.scale.set(radius,length,radius);
    pipe.castShadow=true; pipe.receiveShadow=true; scene.add(pipe);
    for(const [t,bandMaterial] of bands){
      const band=new THREE.Mesh(bandGeometry,bandMaterial);
      band.position.copy(center).addScaledVector(direction,t*length-.5*length);
      band.quaternion.copy(rotation); band.scale.set(radius,1,radius);
      band.castShadow=true; scene.add(band);
    }
  };
  const addSupport=(x,y,z)=>{
    box('pipe hanger',[.48,.07,.09],[x,y+.16,z],pipeDark,false);
    box('pipe hanger',[.07,.28,.09],[x,y+.02,z],pipeDark,false);
  };
  for(const x of [-9.4,9.4]){
    addPipe([x,3.45,-19],[x,3.45,19],.14,pipeMaterial,[[.18,pipeAmber],[.53,pipeAmber],[.84,pipeAmber]]);
    for(let z=-16;z<=16;z+=4) addSupport(x,3.45,z);
  }
  for(const x of [-4.6,0,4.6]){
    addPipe([x,3.69,-19],[x,3.69,19],.105,pipeDark,[[.3,pipeCyan],[.72,pipeCyan]]);
    for(let z=-16;z<=16;z+=8) box('ceiling pipe clamp',[.34,.08,.1],[x,3.82,z],pipeMaterial,false);
  }
  const pipeModelUrl=import.meta.env.BASE_URL+'models/sci-fi-09-pipes.obj';
  new OBJLoader().load(pipeModelUrl,pipeBundle=>{
    pipeBundle.updateMatrixWorld(true);
    const center=new THREE.Box3().setFromObject(pipeBundle).getCenter(new THREE.Vector3());
    const surface=new THREE.MeshStandardMaterial({color:0x737d80,roughness:.68,metalness:.38});
    pipeBundle.traverse(object=>{
      if(!object.isMesh)return;
      object.geometry.translate(-center.x,-center.y,-center.z);
      object.geometry.computeBoundingBox();
      object.geometry.computeBoundingSphere();
      object.material=surface;
      object.castShadow=true;
      object.receiveShadow=true;
    });
    for(const side of [-1,1]){
      for(const z of [-15,-10,-5,0,5,10,15]){
        const bundle=pipeBundle.clone(true);
        bundle.rotation.y=Math.PI/2;
        bundle.scale.setScalar(.0055);
        bundle.position.set(side*9.72,3.42,z);
        scene.add(bundle);
      }
    }
  },undefined,error=>console.error('Failed to load the Sci-Fi 09 pipe model.',error));

  // Center service machinery divides the line of sight.
  [-7.5,7.5].forEach(x => {
    for (let z=-12; z<=10; z+=7) box('server',[4.2,3.1,4.2],[x,1.55,z],black);
  });
  [-10,-6,-2,2,6,10].forEach(z => {
    box('barrier',[.16,2.2,5],[0,1.1,z],mat(0x252c2e));
  });

  // Gate at the far end.
  box('gate left',[3,4,.5],[-8.5,2,-20.5],metal);
  box('gate right',[3,4,.5],[8.5,2,-20.5],metal);
  box('gate',[14,.25,.25],[0,3.65,-20.5],metal,false);

  const corePos = [[-7.8,1.25,-16], [7.8,1.25,-4], [-7.8,1.25,8]];
  corePos.forEach((p,i) => {
    box('core pedestal',[1.15,1.4,1.15],[p[0],.7,p[2]],metal);
    box('pedestal inset',[.78,.035,.78],[p[0],1.42,p[2]],mat(0x0b1718,.4,cyan),false);
    const core = new THREE.Group();
    core.position.set(p[0],1.55,p[2]); core.userData.kind='core'; core.userData.taken=false; core.userData.name=`Memory core ${i+1}`;
    const crystal = new THREE.Mesh(new THREE.IcosahedronGeometry(.32,1),mat(0x123a38,.16,cyan));
    const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(.43,1),new THREE.MeshBasicMaterial({color:cyan,wireframe:true,transparent:true,opacity:.36}));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.57,.018,6,48),new THREE.MeshBasicMaterial({color:cyan,transparent:true,opacity:.8}));
    const orbit = new THREE.Group();
    for(let shard=0;shard<3;shard++){
      const sliver=new THREE.Mesh(new THREE.OctahedronGeometry(.075,0),mat(0x70fff0,.22,cyan));
      const angle=shard*Math.PI*2/3;
      sliver.position.set(Math.cos(angle)*.52,Math.sin(angle*.7)*.18,Math.sin(angle)*.52);
      orbit.add(sliver);
    }
    ring.rotation.x=Math.PI/2.35;
    core.add(crystal,shell,ring,orbit);
    core.userData.parts={crystal,shell,ring,orbit};
    scene.add(core); interactables.push(core); addLight(cyan,2,[p[0],1.8,p[2]],4);
  });

  const exit = box('exit panel',[.7,1.2,.25],[0,1.6,-20.7],mat(0x40202a,.4,red));
  exit.userData.kind='exit'; interactables.push(exit);
  addLight(0xff3158,.8,[0,2,-19.5],5);

  for (let z=-18; z<20; z+=6) {
    addLight(z % 12 ? cyan : 0xffb86b, z % 12 ? 1.7 : 1.1, [9.55,3.5,z],7);
  }
  scene.add(new THREE.HemisphereLight(0x5d8581,0x050505,.38));
  const ambient = new THREE.DirectionalLight(0x819caa,.16); ambient.position.set(-4,8,10); scene.add(ambient);
  const overheadLight = new THREE.PointLight(0xbcdde0,.38,18,1.8); overheadLight.position.set(0,3.7,-19); scene.add(overheadLight);

  // Floor hazard marks and wall signage.
  for (let i=0;i<55;i++) {
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(.12+Math.random()*0.4,.025+Math.random()*0.07),mat(i%9?0x263037:0x7a4d14,.7));
    blob.rotation.x=-Math.PI/2; blob.position.set((Math.random()*19)-9.5,.012,(Math.random()*40)-20); scene.add(blob);
  }
}

function makeEnemy(z) {
  const group = new THREE.Group();
  const shell=mat(0x101719,.38), edge=mat(0x354448,.32,.12), joints=mat(0x050809,.6);
  const eyeMat=new THREE.MeshStandardMaterial({color:0xc8fff8,emissive:cyan,emissiveIntensity:3.5,roughness:.18});
  const rig={legs:[],arms:[]};
  const torso=new THREE.Group();
  const chassis=new THREE.Mesh(new THREE.CylinderGeometry(.42,.65,1.15,8),shell);
  chassis.position.y=1.48;
  const chest=new THREE.Mesh(new THREE.BoxGeometry(.62,.48,.18),edge);
  chest.position.set(0,1.62,.36);
  const core=new THREE.Mesh(new THREE.OctahedronGeometry(.16,1),mat(0x174340,.2,cyan));
  core.position.set(0,1.63,.48);
  const waist=new THREE.Mesh(new THREE.CylinderGeometry(.34,.44,.24,8),joints);
  waist.position.y=.87;
  torso.add(chassis,chest,core,waist);

  const head=new THREE.Group();
  head.position.y=2.2;
  const skull=new THREE.Mesh(new THREE.IcosahedronGeometry(.38,1),shell);
  skull.scale.set(.88,1.1,.8);
  const faceplate=new THREE.Mesh(new THREE.BoxGeometry(.47,.2,.12),joints);
  faceplate.position.set(0,-.02,.29);
  const eye=new THREE.Mesh(new THREE.BoxGeometry(.34,.055,.035),eyeMat);
  eye.position.set(0,-.015,.36);
  const sensor=new THREE.Mesh(new THREE.CylinderGeometry(.035,.055,.34,6),edge);
  sensor.position.set(0,.4,0);
  const sensorLight=new THREE.Mesh(new THREE.SphereGeometry(.055,8,6),eyeMat);
  sensorLight.position.set(0,.57,0);
  head.add(skull,faceplate,eye,sensor,sensorLight);

  for(const side of [-1,1]){
    const shoulder=new THREE.Group();
    shoulder.position.set(side*.55,1.83,0);
    const shoulderCap=new THREE.Mesh(new THREE.IcosahedronGeometry(.24,1),edge);
    shoulder.add(shoulderCap);
    const upper=new THREE.Mesh(new THREE.CylinderGeometry(.12,.16,.48,7),shell);
    upper.position.y=-.3;
    shoulder.add(upper);
    const elbow=new THREE.Mesh(new THREE.SphereGeometry(.14,8,6),joints);
    elbow.position.y=-.57;
    shoulder.add(elbow);
    const forearm=new THREE.Mesh(new THREE.CylinderGeometry(.08,.13,.45,7),edge);
    forearm.position.y=-.82;
    shoulder.add(forearm);
    const claw=new THREE.Group();
    claw.position.set(0,-1.08,.03);
    for(const offset of [-.08,.08]){
      const finger=new THREE.Mesh(new THREE.ConeGeometry(.045,.24,5),shell);
      finger.position.set(offset,-.1,.02);
      finger.rotation.x=-.28;
      claw.add(finger);
    }
    shoulder.add(claw); torso.add(shoulder); rig.arms.push(shoulder);

    const hip=new THREE.Group();
    hip.position.set(side*.27,.82,0);
    const thigh=new THREE.Mesh(new THREE.CylinderGeometry(.18,.13,.52,7),shell);
    thigh.position.y=-.28;
    hip.add(thigh);
    const knee=new THREE.Mesh(new THREE.SphereGeometry(.14,8,6),edge);
    knee.position.y=-.56;
    hip.add(knee);
    const shin=new THREE.Mesh(new THREE.CylinderGeometry(.09,.13,.42,7),shell);
    shin.position.y=-.79;
    hip.add(shin);
    const foot=new THREE.Mesh(new THREE.BoxGeometry(.26,.12,.4),edge);
    foot.position.set(0,-1.02,.1);
    hip.add(foot); torso.add(hip); rig.legs.push(hip);
  }
  group.add(torso,head);
  group.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
  group.position.set(8,0,z);
  group.userData={angle:0,state:'hunt',cooldown:0,rig,torso,head,core};
  scene.add(group); enemies.push(group);
}

buildStation();
makeEnemy(-10);
makeEnemy(4);

function isBlocked(pos) {
  const p = new THREE.Vector3(pos.x,1,pos.z);
  return colliders.some(b=>b.expandByScalar(-.16).containsPoint(p));
}

function move(dt) {
  const forward = new THREE.Vector3(-Math.sin(yaw),0,-Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw),0,-Math.sin(yaw));
  const input = new THREE.Vector3();
  if(keys.KeyW||keys.ArrowUp) input.add(forward); if(keys.KeyS||keys.ArrowDown) input.sub(forward);
  if(keys.KeyD||keys.ArrowRight) input.add(right); if(keys.KeyA||keys.ArrowLeft) input.sub(right);
  if(input.lengthSq()) {
    input.normalize();
    isMoving=true;
    const sprinting=keys.ShiftLeft||keys.ShiftRight;
    const speed=(sprinting?7:4.2)*(battery>0?1:.78); dt=Math.min(dt,.05);
    walkPhase+=dt*(sprinting?12.4:8.8);
    const next=player.position.clone().addScaledVector(input,speed*dt);
    if(Math.abs(next.x)<9.35&&!isBlocked(next)) player.position.x=next.x;
    if(Math.abs(next.z)<20.35&&!isBlocked(next)) player.position.z=next.z;
    if(keys.ShiftLeft||keys.ShiftRight) battery=Math.max(0,battery-dt*2.2);
    if(flashlightOn) battery=Math.max(0,battery-dt*2.8);
    if(!keys.ShiftLeft&&!keys.ShiftRight&&!flashlightOn) battery=Math.min(100,battery+dt*.55);
    if(battery<=0 && flashlightOn) toggleFlashlight();
    const gait=Math.sin(walkPhase);
    camera.position.y=1.65+gait*.026;
  } else {
    isMoving=false;
    camera.position.y+=(1.65-camera.position.y)*dt*12;
  }
}

function nearby() {
  let best=null, distance=1.9;
  for(const o of interactables){ if(o.visible){const d=o.position.distanceTo(player.position);if(d<distance){distance=d;best=o;}} }
  return best;
}

function interact() {
  if(!started||ended) return;
  const o=nearby();
  if(!o) return;
  if(o.userData.kind==='core') { o.visible=false; o.userData.taken=true; cores++; objective.text('Recovered core '+cores+' / 3'); document.querySelector('#flash').classList.remove('fire'); void document.querySelector('#flash').offsetWidth; document.querySelector('#flash').classList.add('fire'); }
  else if(cores===3) finish(true); else objective.text('Gate locked: 3 cores required ('+cores+'/3)');
}

const objective = { text:s=>document.querySelector('#objective').textContent=s };

function finish(won) {
  ended=true; document.exitPointerLock?.();
  const panel=document.querySelector('.panel');
  panel.innerHTML=won
    ? '<div class="kicker">STATION SECURED // 03:41</div><h1>YOU<em>ESCAPED</em></h1><p class="intro">The cores are restored. The construct is silent, but you can still hear your own voice repeating from the service line.</p><button id="restart">RUN AGAIN</button>'
    : '<div class="kicker">COGNITIVE FAILURE // FEED LOST</div><h1>FEED<em>TERMINATED</em></h1><p class="intro">The station kept one of you. The maintenance construct carries your memory now.</p><button id="restart">RESTORE SESSION</button>';
  document.querySelector('#overlay').classList.remove('hidden');
  document.querySelector('#restart').onclick=()=>location.reload();
}

function updateEnemies(dt) {
  enemies.forEach((e,i)=>{
    const to=player.position.clone().sub(e.position); to.y=0;
    const distance=to.length();
    const alerted=distance<13 || (cores>0 && distance<18);
    if(alerted) {
      e.userData.state='hunt';
      if(distance>1.25) e.position.addScaledVector(to.normalize(),(cores>=3?3.15:2.35)*dt);
      e.lookAt(player.position.x,e.position.y,player.position.z);
      if(distance<1.65) {
        sanity-=dt*(distance<.9?29:16);
        document.querySelector('#damage').style.opacity=.15+Math.min(.55,(1.65-distance)*.6);
        if(sanity<=0) finish(false);
      }
    } else {
      e.userData.angle+=dt*(.45+i*.08); e.position.x=8*Math.sin(e.userData.angle)+Math.sin(i)*2;
      e.lookAt(player.position.x,e.position.y,player.position.z);
    }
  });
}

function updateHud(dt) {
  sanity+=dt*.9;
  sanity=Math.min(100, sanity+(nearby()?.visible?0:0));
  document.querySelector('#sanFill').style.width=sanity+'%';
  document.querySelector('#sanText').textContent=Math.max(0,Math.ceil(sanity));
  document.querySelector('#sanFill').style.background=sanity<35?'#ff3158':'#55f5df';
  document.querySelector('#battery').textContent=Math.ceil(battery)+'%';
  document.querySelector('#prompt').classList.toggle('visible',!!nearby()&&started&&!ended);
  if(!nearby()) document.querySelector('#damage').style.opacity=Math.max(0,+document.querySelector('#damage').style.opacity-dt*2);
}

const pulseMats=[];
scene.traverse(o=>{ if(o.isMesh && o.material?.emissive?.b) pulseMats.push(o.material); });

function animate() {
  requestAnimationFrame(animate);
  const dt=Math.min(clock.getDelta(),.05);
  finishPass.uniforms.time.value=clock.elapsedTime;
  dust.rotation.y=Math.sin(clock.elapsedTime*.07)*.012;
  const dustPosition=dustGeometry.attributes.position;
  for(let i=1;i<dustCount*3;i+=3){dustPosition.array[i]+=dt*.0015*(.35+(i%7)*.035);if(dustPosition.array[i]>3.7)dustPosition.array[i]=.2;} 
  dustPosition.needsUpdate=true;
  if(started&&!ended) {
    move(dt); camera.position.set(player.position.x, camera.position.y, player.position.z);
    const sway=isMoving?Math.sin(walkPhase*.5)*.0048:0;
    camera.rotation.z+=(sway-camera.rotation.z)*Math.min(1,dt*10);
    flashlightTarget.position.x=Math.sin(walkPhase*.5)*.018;
    updateEnemies(dt); updateHud(dt);
    enemies.forEach((e,i)=>{
      const {rig,torso,head,core}=e.userData;
      const hunting=e.userData.state==='hunt'&&(player.position.distanceTo(e.position)<18);
      const stride=clock.elapsedTime*(hunting?9:2.2)+i*Math.PI;
      const gait=hunting?Math.sin(stride):Math.sin(stride)*.16;
      rig.legs.forEach((leg,index)=>{leg.rotation.x=gait*(index===0?1:-1);});
      rig.arms.forEach((arm,index)=>{arm.rotation.x=-gait*(index===0?1:-1)-.12;arm.rotation.z=(index===0?1:-1)*.08;});
      torso.position.y=Math.abs(Math.sin(stride))*(hunting?.075:.018);
      torso.rotation.z=hunting?Math.sin(stride)*.025:0;
      head.rotation.y=Math.sin(clock.elapsedTime*1.7+i*2)*.14;
      core.rotation.y=clock.elapsedTime*1.8;
    });
    interactables.forEach((o,i)=>{ if(o.visible&&o.userData.kind==='core'){
      const {crystal,shell,ring,orbit}=o.userData.parts;
      o.rotation.y+=dt*.42;
      o.position.y=1.55+Math.sin(clock.elapsedTime*2+i)*.12;
      crystal.rotation.y=-clock.elapsedTime*.7;
      shell.rotation.set(clock.elapsedTime*.18, -clock.elapsedTime*.32, clock.elapsedTime*.12);
      ring.rotation.z=clock.elapsedTime*.75+i;
      orbit.rotation.set(clock.elapsedTime*.55,clock.elapsedTime*.8,clock.elapsedTime*.3);
    } });
    pulseMats.forEach((m,i)=>{ if(m.emissive&&m.emissive.getHex()!=0) m.emissiveIntensity=1.4+Math.sin(clock.elapsedTime*3+i)*.55; });
  }
  post.render();
}

camera.position.copy(player.position); camera.quaternion.copy(player.quaternion);
scene.add(camera);
scene.onBeforeRender=()=>{};

const start = ()=>{
  started=true; document.querySelector('#overlay').classList.add('hidden'); renderer.domElement.requestPointerLock?.();
};
document.querySelector('#start').onclick=start;
document.addEventListener('pointerlockchange',()=>{ if(!document.pointerLockElement&&!ended&&started) { keys.KeyW=keys.KeyA=keys.KeyS=keys.KeyD=false; } });
document.addEventListener('keydown',e=>{ keys[e.code]=true;if(e.code==='KeyE')interact();if(e.code==='KeyF'&&!e.repeat)toggleFlashlight(); });
document.addEventListener('keyup',e=>keys[e.code]=false);
document.addEventListener('mousemove',e=>{
  if(document.pointerLockElement!==renderer.domElement||ended) return;
  yaw-=e.movementX*.0022; pitch-=e.movementY*.0022; pitch=Math.max(-1.25,Math.min(1.25,pitch));
  player.rotation.set(0,yaw,0); camera.rotation.set(pitch,yaw,0);
});

let touchX=0,touchY=0;
document.querySelector('#moveStick').addEventListener('touchmove',e=>{ const r=e.target.getBoundingRect?.()||e.target.getBoundingClientRect();const t=e.touches[0];touchX=(t.clientX-(r.left+r.width/2))/42;touchY=(t.clientY-(r.top+r.height/2))/42;keys.KeyW=touchY<-.25;keys.KeyS=touchY>.25;keys.KeyA=touchX<-.25;keys.KeyD=touchX>.25; });
document.querySelector('#moveStick').addEventListener('touchend',()=>{touchX=touchY=0;keys.KeyW=keys.KeyA=keys.KeyS=keys.KeyD=false;});
document.querySelector('#actionButton').addEventListener('touchstart',interact);
document.querySelector('#flashlightButton').addEventListener('touchstart',toggleFlashlight);
let touchLook=null;
renderer.domElement.addEventListener('touchstart',e=>{ if(started&&!e.target.closest?.('#mobile')) touchLook={x:e.touches[0].clientX,y:e.touches[0].clientY}; });
renderer.domElement.addEventListener('touchmove',e=>{ if(!touchLook)return;const t=e.touches[0];yaw-=((t.clientX-touchLook.x)*.007);pitch-=((t.clientY-touchLook.y)*.007);pitch=Math.max(-1.25,Math.min(1.25,pitch));camera.rotation.set(pitch,yaw,0);touchLook={x:t.clientX,y:t.clientY}; });
renderer.domElement.addEventListener('touchend',()=>touchLook=null);

renderer.domElement.addEventListener('click',()=>{if(started&&!ended&&!document.pointerLockElement)renderer.domElement.requestPointerLock?.();});
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);post.setSize(innerWidth,innerHeight);finishPass.uniforms.resolution.value.set(innerWidth,innerHeight);});
animate();
