(() => {
  const fluidCanvas = document.querySelector('#fluid-canvas')
  const gridCanvas = document.querySelector('#grid-canvas')
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const lowPowerDevice =
    (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) ||
    (navigator.deviceMemory && navigator.deviceMemory <= 4)

  const params = {
    mouseRadius: 0.09,
    mouseStrength: 1.8,
    mouseSmoothing: 0.1,
    mouseVelocity: 0.2,
    decay: 0.925,
    distortBoost: 2.2,
    noiseBoost: 0.3,
    swirlBoost: 0.8,
    glowIntensity: 0.13,
    glowColors: ['#fff7d1', '#538dca', '#2d448b'],
    speed: 28,
    scale: 1.77,
    offsetX: -124,
    offsetY: -48,
    grain: 0.005,
    colors: ['#000000', '#1A3870', '#204a7e', '#eed8aa', '#000000'],
    lightX: 0.89,
    lightY: 0.46,
    lightCore: 0.14,
    lightHalo: 0.2,
    vignette: 0.38,
    lightFollow: 0.63,
    bloomThreshold: 0.61,
    bloomRange: 0.18,
    bloomStrength: 0.4,
  }

  const vertexShader = `#version 300 es
    in vec4 a_position;
    out vec2 vUv;
    void main() {
      vUv = a_position.xy * 0.5 + 0.5;
      gl_Position = a_position;
    }
  `

  const flowShader = `#version 300 es
    precision mediump float;
    in vec2 vUv;
    uniform sampler2D u_prev;
    uniform vec2 u_mouse;
    uniform vec2 u_velocity;
    uniform float u_brushRadius;
    uniform float u_brushStrength;
    uniform float u_decay;
    out vec4 fragColor;

    void main() {
      vec4 prev = texture(u_prev, vUv);
      prev.r *= u_decay;
      prev.gb = mix(vec2(0.5), prev.gb, u_decay);
      float dist = distance(vUv, u_mouse);
      float influence = exp(-dist * dist / (u_brushRadius * u_brushRadius * 0.5));
      influence = max(0.0, influence - 0.01);
      float speed = length(u_velocity);
      float presenceStrength = u_brushStrength * 0.3;
      float velBonus = min(speed * 3.0, 0.7) * u_brushStrength;
      float totalStrength = presenceStrength + velBonus;
      prev.r = max(prev.r, influence * totalStrength);
      float blendAmt = influence * min(totalStrength, 0.4) * 0.3;
      prev.g = mix(prev.g, clamp(u_velocity.x * 2.0 + 0.5, 0.0, 1.0), blendAmt);
      prev.b = mix(prev.b, clamp(u_velocity.y * 2.0 + 0.5, 0.0, 1.0), blendAmt);
      fragColor = prev;
    }
  `

  const fluidShader = `#version 300 es
    precision mediump float;
    in vec2 vUv;
    uniform float u_time;
    uniform vec2 u_resolution;
    uniform vec3 u_c1, u_c2, u_c3, u_c4, u_c5;
    uniform float u_scale;
    uniform vec2 u_offset;
    uniform float u_grain;
    uniform float u_speed;
    uniform sampler2D u_flowmap;
    uniform float u_distortBoost;
    uniform float u_swirlBoost;
    uniform float u_glowIntensity;
    uniform vec3 u_glowColor1;
    uniform vec3 u_glowColor2;
    uniform vec3 u_glowColor3;
    uniform vec2 u_lightPos;
    uniform float u_lightCore;
    uniform float u_lightHalo;
    uniform float u_vignette;
    uniform float u_bloomThreshold;
    uniform float u_bloomRange;
    uniform float u_bloomStrength;
    out vec4 fragColor;

    vec3 mod289v3(vec3 x){return x-floor(x*(1./289.))*289.;}
    vec4 mod289v4(vec4 x){return x-floor(x*(1./289.))*289.;}
    vec4 permute(vec4 x){return mod289v4(((x*34.)+1.)*x);}
    vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-.85373472095314*r;}

    float snoise(vec3 v){
      const vec2 C=vec2(1./6.,1./3.);
      const vec4 D=vec4(0.,.5,1.,2.);
      vec3 i=floor(v+dot(v,C.yyy));
      vec3 x0=v-i+dot(i,C.xxx);
      vec3 g=step(x0.yzx,x0.xyz);
      vec3 l=1.-g;
      vec3 i1=min(g.xyz,l.zxy);
      vec3 i2=max(g.xyz,l.zxy);
      vec3 x1=x0-i1+C.xxx;
      vec3 x2=x0-i2+C.yyy;
      vec3 x3=x0-D.yyy;
      i=mod289v3(i);
      vec4 p=permute(permute(permute(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
      float n_=.142857142857;
      vec3 ns=n_*D.wyz-D.xzx;
      vec4 j=p-49.*floor(p*ns.z*ns.z);
      vec4 x_=floor(j*ns.z);
      vec4 y_=floor(j-7.*x_);
      vec4 x=x_*ns.x+ns.yyyy;
      vec4 y=y_*ns.x+ns.yyyy;
      vec4 h=1.-abs(x)-abs(y);
      vec4 b0=vec4(x.xy,y.xy);
      vec4 b1=vec4(x.zw,y.zw);
      vec4 s0=floor(b0)*2.+1.;
      vec4 s1=floor(b1)*2.+1.;
      vec4 sh=-step(h,vec4(0.));
      vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
      vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
      vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);
      vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
      vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
      p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
      vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);
      m=m*m;
      return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
    }

    float hash(vec2 p){
      vec3 p3=fract(vec3(p.xyx)*.1031);
      p3+=dot(p3,p3.yzx+33.33);
      return fract((p3.x+p3.y)*p3.z);
    }

    float fbm(vec3 p){
      float v=0.,amp=.6;vec3 shift=vec3(100.);
      for(int i=0;i<1;i++){v+=amp*snoise(p);p=p*2.+shift;amp*=.4;}
      return v;
    }

    float fluidNoise(vec2 uv,float t){
      float n1=fbm(vec3(uv*.6,t*.06));
      float n2=fbm(vec3(uv*.6+5.2,t*.06+1.3));
      vec2 w1=vec2(n1,n2)*.6;
      float n3=fbm(vec3((uv+w1)*.7+1.7,t*.05+3.1));
      float n4=fbm(vec3((uv+w1)*.7+9.2,t*.05+5.7));
      vec2 w2=vec2(n3,n4)*.5;
      return fbm(vec3((uv+w1+w2)*.5,t*.04));
    }

    vec2 curlish(vec2 uv,float t){
      float eps=.02;
      float n=snoise(vec3(uv*.8,t));
      float nx=snoise(vec3((uv+vec2(eps,0.))*.8,t));
      float ny=snoise(vec3((uv+vec2(0.,eps))*.8,t));
      return vec2(-(ny-n)/eps,(nx-n)/eps)*.003;
    }

    void main(){
      float aspect=u_resolution.x/u_resolution.y;
      vec2 uv=gl_FragCoord.xy/u_resolution;
      vec2 suv=vec2(uv.x*aspect, uv.y) * u_scale + u_offset;
      float t=u_time;
      vec4 flow = texture(u_flowmap, uv);
      float influence = flow.r;
      vec2 flowDir = (flow.gb - 0.5) * 2.0;
      suv += flowDir * influence * u_distortBoost * 0.8;
      float swirlAngle = influence * u_swirlBoost * 2.5;
      float cs = cos(swirlAngle), sn = sin(swirlAngle);
      vec2 delta = suv - vec2(uv.x * aspect, uv.y) * u_scale;
      suv += (mat2(cs, sn, -sn, cs) * delta - delta) * influence;
      vec2 curl=curlish(suv,t*.04);
      vec2 uvD=suv+curl*12.;
      float f=fluidNoise(uvD,t);
      float swirl=snoise(vec3(uvD*.8+f*1.5,t*.035))*.5+.5;
      float n=f*.5+.5;
      vec3 col=mix(u_c1,u_c2,smoothstep(.2,.5,n));
      col=mix(col,u_c3,smoothstep(.35,.65,n+swirl*.25));
      col=mix(col,u_c4,smoothstep(.6,.85,swirl)*.55);
      col=mix(col,u_c5,smoothstep(.5,.8,n*swirl)*.35);
      float glow = smoothstep(0.0, 0.8, influence);
      float glowNoise = snoise(vec3(uvD * 1.5, t * 0.08)) * 0.5 + 0.5;
      float glowDist = smoothstep(0.0, 1.0, influence);
      vec3 glowMix = mix(u_glowColor3, u_glowColor2, glowDist);
      glowMix = mix(glowMix, u_glowColor1, glowDist * glowNoise);
      col = mix(col, glowMix, glow * u_glowIntensity);
      if(u_grain>0.0){
        vec2 flowOffset = (uvD - suv) * u_resolution.y;
        vec2 gp = floor((gl_FragCoord.xy + flowOffset) / 5.0);
        float gr=hash(gp)*2.-1.;
        col+=gr*u_grain;
      }
      float luma=dot(col,vec3(.299,.587,.114));
      float bloom=smoothstep(u_bloomThreshold-u_bloomRange,u_bloomThreshold+u_bloomRange,luma);
      col+=(col*.85+vec3(.15,.145,.13))*bloom*u_bloomStrength;
      float ld=length((uv-u_lightPos)*vec2(aspect,1.));
      float core=exp(-ld*ld*4.5);
      float halo=exp(-ld*1.8);
      col+=vec3(1.,.97,.9)*core*u_lightCore+vec3(.72,.8,1.)*halo*u_lightHalo;
      float vig=1.-smoothstep(.35,.75,length(uv-.5));
      col=mix(col*(1.-u_vignette),col,vig);
      fragColor=vec4(col,1.);
    }
  `

  function colorToRgb(color) {
    const value = color.replace('#', '')
    return [
      Number.parseInt(value.slice(0, 2), 16) / 255,
      Number.parseInt(value.slice(2, 4), 16) / 255,
      Number.parseInt(value.slice(4, 6), 16) / 255,
    ]
  }

  function startFluid(canvas) {
    if (!canvas) return
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: false,
      powerPreference: 'low-power',
    })
    if (!gl) return

    function createShader(type, source) {
      const shader = gl.createShader(type)
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader
      console.error('[background] shader', gl.getShaderInfoLog(shader))
      return null
    }

    function createProgram(fragmentSource) {
      const vertex = createShader(gl.VERTEX_SHADER, vertexShader)
      const fragment = createShader(gl.FRAGMENT_SHADER, fragmentSource)
      if (!vertex || !fragment) return null
      const program = gl.createProgram()
      gl.attachShader(program, vertex)
      gl.attachShader(program, fragment)
      gl.linkProgram(program)
      if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program
      console.error('[background] link', gl.getProgramInfoLog(program))
      return null
    }

    const flowProgram = createProgram(flowShader)
    const fluidProgram = createProgram(fluidShader)
    if (!flowProgram || !fluidProgram) return

    const flowUniforms = {
      prev: gl.getUniformLocation(flowProgram, 'u_prev'),
      mouse: gl.getUniformLocation(flowProgram, 'u_mouse'),
      velocity: gl.getUniformLocation(flowProgram, 'u_velocity'),
      brushRadius: gl.getUniformLocation(flowProgram, 'u_brushRadius'),
      brushStrength: gl.getUniformLocation(flowProgram, 'u_brushStrength'),
      decay: gl.getUniformLocation(flowProgram, 'u_decay'),
    }
    const fluidUniforms = {}
    ;[
      'time',
      'resolution',
      'scale',
      'offset',
      'grain',
      'speed',
      'flowmap',
      'distortBoost',
      'swirlBoost',
      'glowIntensity',
      'glowColor1',
      'glowColor2',
      'glowColor3',
      'c1',
      'c2',
      'c3',
      'c4',
      'c5',
      'lightPos',
      'lightCore',
      'lightHalo',
      'vignette',
      'bloomThreshold',
      'bloomRange',
      'bloomStrength',
    ].forEach((name) => {
      fluidUniforms[name] = gl.getUniformLocation(fluidProgram, `u_${name}`)
    })

    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    )

    function bindPosition(program) {
      const location = gl.getAttribLocation(program, 'a_position')
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.enableVertexAttribArray(location)
      gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0)
    }

    function createTarget(width, height, data) {
      const texture = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        width,
        height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        data || null,
      )
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      const framebuffer = gl.createFramebuffer()
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        texture,
        0,
      )
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      return { framebuffer, texture }
    }

    // This is a full-window procedural shader. Rendering it above CSS-pixel
    // resolution adds a lot of GPU work with almost no visible benefit behind
    // the grain and gradient layers.
    const pixelRatio = Math.min(window.devicePixelRatio || 1, lowPowerDevice ? 0.8 : 1)
    let width = Math.round(canvas.clientWidth * pixelRatio)
    let height = Math.round(canvas.clientHeight * pixelRatio)
    canvas.width = width
    canvas.height = height
    const flowWidth = Math.round(width / 4)
    const flowHeight = Math.round(height / 4)
    const initialFlow = new Uint8Array(flowWidth * flowHeight * 4)
    for (let index = 0; index < flowWidth * flowHeight; index += 1) {
      initialFlow[index * 4] = 0
      initialFlow[index * 4 + 1] = 128
      initialFlow[index * 4 + 2] = 128
      initialFlow[index * 4 + 3] = 255
    }
    const targetA = createTarget(flowWidth, flowHeight, initialFlow)
    const targetB = createTarget(flowWidth, flowHeight, initialFlow)
    let useFirst = false
    let visible = true
    let animationFrame = 0
    let lastFrame = 0
    let revealed = false
    const startedAt = performance.now()
    const pointer = {
      x: 0.5,
      y: 0.5,
      smoothX: 0.5,
      smoothY: 0.5,
      smoothVelocityX: 0,
      smoothVelocityY: 0,
    }
    const coarsePointer = window.matchMedia('(hover: none), (pointer: coarse)').matches
    const isWindows = navigator.userAgentData
      ? navigator.userAgentData.platform === 'Windows'
      : navigator.userAgent.includes('Windows')
    const interactive = !coarsePointer && !isWindows
    const frameInterval = 1000 / (lowPowerDevice ? 24 : 30)

    function updatePointer(event) {
      const bounds = canvas.getBoundingClientRect()
      pointer.x = (event.clientX - bounds.left) / bounds.width
      pointer.y = 1 - (event.clientY - bounds.top) / bounds.height
    }
    if (interactive) window.addEventListener('mousemove', updatePointer)

    function render(timestamp) {
      animationFrame = window.requestAnimationFrame(render)
      if (document.hidden || !visible || timestamp - lastFrame < frameInterval) return
      lastFrame = timestamp - ((timestamp - lastFrame) % frameInterval)

      const nextRatio = Math.min(window.devicePixelRatio || 1, lowPowerDevice ? 0.8 : 1)
      const nextWidth = Math.round(canvas.clientWidth * nextRatio)
      const nextHeight = Math.round(canvas.clientHeight * nextRatio)
      if (nextWidth !== width || nextHeight !== height) {
        width = nextWidth
        height = nextHeight
        canvas.width = width
        canvas.height = height
      }

      pointer.smoothX += (pointer.x - pointer.smoothX) * params.mouseSmoothing
      pointer.smoothY += (pointer.y - pointer.smoothY) * params.mouseSmoothing
      pointer.smoothVelocityX +=
        ((pointer.x - pointer.smoothX) * 0.5 - pointer.smoothVelocityX) * params.mouseVelocity
      pointer.smoothVelocityY +=
        ((pointer.y - pointer.smoothY) * 0.5 - pointer.smoothVelocityY) * params.mouseVelocity

      const previous = useFirst ? targetA : targetB
      const next = useFirst ? targetB : targetA
      useFirst = !useFirst

      gl.bindFramebuffer(gl.FRAMEBUFFER, next.framebuffer)
      gl.viewport(0, 0, flowWidth, flowHeight)
      gl.useProgram(flowProgram)
      bindPosition(flowProgram)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, previous.texture)
      gl.uniform1i(flowUniforms.prev, 0)
      gl.uniform2f(flowUniforms.mouse, pointer.smoothX, pointer.smoothY)
      gl.uniform2f(
        flowUniforms.velocity,
        pointer.smoothVelocityX,
        pointer.smoothVelocityY,
      )
      gl.uniform1f(flowUniforms.brushRadius, params.mouseRadius)
      gl.uniform1f(flowUniforms.brushStrength, interactive ? params.mouseStrength : 0)
      gl.uniform1f(flowUniforms.decay, params.decay)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, width, height)
      gl.useProgram(fluidProgram)
      bindPosition(fluidProgram)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, next.texture)
      gl.uniform1i(fluidUniforms.flowmap, 0)
      gl.uniform1f(
        fluidUniforms.time,
        (timestamp - startedAt) * 0.001 * (params.speed / 100),
      )
      gl.uniform2f(fluidUniforms.resolution, width, height)
      gl.uniform1f(fluidUniforms.scale, params.scale)
      gl.uniform2f(fluidUniforms.offset, params.offsetX / 100, params.offsetY / 100)
      gl.uniform1f(fluidUniforms.grain, params.grain)
      gl.uniform1f(fluidUniforms.distortBoost, params.distortBoost)
      gl.uniform1f(fluidUniforms.swirlBoost, params.swirlBoost)
      gl.uniform1f(fluidUniforms.glowIntensity, params.glowIntensity)
      gl.uniform2f(
        fluidUniforms.lightPos,
        params.lightX + (pointer.smoothX - params.lightX) * (interactive ? params.lightFollow : 0),
        params.lightY,
      )
      gl.uniform1f(fluidUniforms.lightCore, coarsePointer ? 0 : params.lightCore)
      gl.uniform1f(fluidUniforms.lightHalo, coarsePointer ? 0 : params.lightHalo)
      gl.uniform1f(fluidUniforms.vignette, params.vignette)
      gl.uniform1f(fluidUniforms.bloomThreshold, params.bloomThreshold)
      gl.uniform1f(fluidUniforms.bloomRange, params.bloomRange)
      gl.uniform1f(fluidUniforms.bloomStrength, params.bloomStrength)

      params.glowColors.forEach((color, index) => {
        const rgb = colorToRgb(color)
        gl.uniform3f(fluidUniforms[`glowColor${index + 1}`], rgb[0], rgb[1], rgb[2])
      })
      params.colors.forEach((color, index) => {
        const rgb = colorToRgb(color)
        gl.uniform3f(fluidUniforms[`c${index + 1}`], rgb[0], rgb[1], rgb[2])
      })
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

      if (!revealed) {
        revealed = true
        document.body.classList.add('is-fluid-ready')
      }
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting
      },
      { threshold: 0 },
    )
    observer.observe(canvas)
    animationFrame = window.requestAnimationFrame(render)
  }

  function startGrid(canvas) {
    if (!canvas || window.matchMedia('(hover: none), (pointer: coarse)').matches) return
    const context = canvas.getContext('2d', { alpha: true, desynchronized: true })
    if (!context) return
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 1)
    const pointer = { x: Number.NaN, y: Number.NaN }
    const points = []
    let width = canvas.clientWidth
    let height = canvas.clientHeight
    let columns = 0
    let rows = 0
    let resizeTimer = 0
    let lastFrame = 0

    function rebuild() {
      columns = Math.ceil(width / 90) + 1
      rows = Math.ceil(height / 90) + 1
      const startX = (width - (columns - 1) * 90) / 2
      const startY = (height - (rows - 1) * 90) / 2
      points.length = 0
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const x = startX + 90 * column
          const y = startY + 90 * row
          points.push({ restX: x, restY: y, x, y, velocityX: 0, velocityY: 0 })
        }
      }
    }

    function resize() {
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = width * pixelRatio
      canvas.height = height * pixelRatio
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      rebuild()
    }

    function updatePointer(event) {
      const bounds = canvas.getBoundingClientRect()
      pointer.x = event.clientX - bounds.left
      pointer.y = event.clientY - bounds.top
    }
    window.addEventListener('mousemove', updatePointer)

    function connect(first, second) {
      const deltaX = second.x - first.x
      const deltaY = second.y - first.y
      const distance = Math.hypot(deltaX, deltaY)
      if (distance < 20) return
      const directionX = deltaX / distance
      const directionY = deltaY / distance
      context.beginPath()
      context.moveTo(first.x + 10 * directionX, first.y + 10 * directionY)
      context.lineTo(second.x - 10 * directionX, second.y - 10 * directionY)
      context.stroke()
    }

    function render(timestamp) {
      window.requestAnimationFrame(render)
      if (document.hidden || timestamp - lastFrame < 1000 / 30) return
      lastFrame = timestamp - ((timestamp - lastFrame) % (1000 / 30))
      const nextWidth = canvas.clientWidth
      const nextHeight = canvas.clientHeight
      if (nextWidth !== width || nextHeight !== height) {
        width = nextWidth
        height = nextHeight
        canvas.width = width * pixelRatio
        canvas.height = height * pixelRatio
        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
        window.clearTimeout(resizeTimer)
        resizeTimer = window.setTimeout(rebuild, 150)
      }

      context.clearRect(0, 0, width, height)
      points.forEach((point) => {
        const deltaX = point.x - pointer.x
        const deltaY = point.y - pointer.y
        const distance = Math.hypot(deltaX, deltaY)
        if (distance < 140 && distance > 0.1) {
          const force = (1 - distance / 140) * 30
          point.velocityX += (deltaX / distance) * force * 0.1
          point.velocityY += (deltaY / distance) * force * 0.1
        }
        point.velocityX += 0.05 * (point.restX - point.x)
        point.velocityY += 0.05 * (point.restY - point.y)
        point.velocityX *= 0.85
        point.velocityY *= 0.85
        point.x += point.velocityX
        point.y += point.velocityY
      })

      context.strokeStyle = 'rgba(255, 255, 255, 0.08)'
      context.lineWidth = 0.5
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns - 1; column += 1) {
          connect(points[row * columns + column], points[row * columns + column + 1])
        }
      }
      for (let column = 0; column < columns; column += 1) {
        for (let row = 0; row < rows - 1; row += 1) {
          connect(points[row * columns + column], points[(row + 1) * columns + column])
        }
      }

      context.fillStyle = 'rgba(255, 255, 255, 0.16)'
      points.forEach((point) => {
        let radius = 1.8
        let opacity = 0.16
        if (!Number.isNaN(pointer.x) && !Number.isNaN(pointer.y)) {
          const distance = Math.hypot(point.x - pointer.x, point.y - pointer.y)
          const proximity = Math.max(0, 1 - distance / 140)
          radius += 2 * proximity
          opacity += 0.4 * proximity
        }
        context.globalAlpha = opacity
        context.fillRect(point.x - radius, point.y - radius, radius * 2, radius * 2)
      })
      context.globalAlpha = 1
    }

    resize()
    window.requestAnimationFrame(render)
  }

  let started = false
  function startVisuals() {
    if (started) return
    started = true
    if (reducedMotion) return

    const startFluidWhenIdle = () => startFluid(fluidCanvas)
    window.setTimeout(() => {
      if ('requestIdleCallback' in window) {
        window.requestIdleCallback(startFluidWhenIdle, { timeout: 320 })
      } else {
        startFluidWhenIdle()
      }
    }, 160)

    // The grid is secondary decoration. Staggering it keeps its canvas setup
    // away from the fluid shader compilation and the page entry transition.
    if (!reducedMotion && !lowPowerDevice) {
      window.setTimeout(() => startGrid(gridCanvas), 650)
    }
  }

  window.addEventListener('startup-shell-ready', startVisuals, { once: true })
  // Fallback for unusual script scheduling where the custom event was emitted
  // before this listener was installed.
  window.setTimeout(startVisuals, 800)
})()
