import * as THREE from '../node_modules/three/build/three.module.min.js'

const stage = document.querySelector('#hero-whale-stage')

if (stage && !window.matchMedia('(max-width: 767px)').matches) {
  const lightParams = {
    x: 4.5,
    y: 5.5,
    z: 3,
    range: 14,
    shadeMin: 0.2,
    shadeMax: 2.79 * 0.4,
    followX: 1.05,
  }
  const mouseParams = { radius: 4.9, strength: 0.8, decay: 0.2, distort: 5 }
  const pointer = { x: 0, y: 0, active: false, moved: false }
  const smoothedPointer = new THREE.Vector2(0, 0)
  const startedAt = performance.now()
  let visible = true
  let lastFrame = 0

  function createPixelData(image, size = 60) {
    const source = document.createElement('canvas')
    source.width = size
    source.height = size
    const context = source.getContext('2d')
    context.fillStyle = '#000'
    context.fillRect(0, 0, size, size)

    const scale = Math.min(size / image.width, size / image.height)
    const width = image.width * scale
    const height = image.height * scale
    context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height)

    const pixels = context.getImageData(0, 0, size, size)
    const luminance = new Float32Array(size * size)
    const positions = []
    const scatteredPositions = []
    const opacities = []
    const edges = []
    const center = size / 2

    for (let index = 0; index < size * size; index += 1) {
      const pixel = index * 4
      luminance[index] =
        (0.299 * pixels.data[pixel] +
          0.587 * pixels.data[pixel + 1] +
          0.114 * pixels.data[pixel + 2]) /
        255
    }

    function hasEmptyNeighbour(x, y) {
      for (let offsetY = -2; offsetY <= 2; offsetY += 1) {
        for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) continue
          const neighbourX = x + offsetX
          const neighbourY = y + offsetY
          if (
            neighbourX < 0 ||
            neighbourY < 0 ||
            neighbourX >= size ||
            neighbourY >= size ||
            luminance[neighbourY * size + neighbourX] <= 0.2
          ) {
            return true
          }
        }
      }
      return false
    }

    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const opacity = luminance[y * size + x]
        if (opacity <= 0.2 || !hasEmptyNeighbour(x, y)) continue

        positions.push((x - center) * 0.18, (center - y) * 0.18, 0)
        opacities.push(opacity)

        let emptyNeighbours = 0
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            if (offsetX === 0 && offsetY === 0) continue
            const neighbourX = x + offsetX
            const neighbourY = y + offsetY
            if (
              neighbourX < 0 ||
              neighbourY < 0 ||
              neighbourX >= size ||
              neighbourY >= size ||
              luminance[neighbourY * size + neighbourX] <= 0.2
            ) {
              emptyNeighbours += 1
            }
          }
        }
        edges.push(emptyNeighbours / 8)

        const azimuth = Math.random() * Math.PI * 2
        const polar = Math.acos(2 * Math.random() - 1)
        const radius = 3 * (0.4 + 0.6 * Math.random())
        scatteredPositions.push(
          Math.sin(polar) * Math.cos(azimuth) * radius,
          Math.sin(polar) * Math.sin(azimuth) * radius,
          Math.cos(polar) * radius * 0.5,
        )
      }
    }

    return {
      positions: new Float32Array(positions),
      scatteredPositions: new Float32Array(scatteredPositions),
      opacities: new Float32Array(opacities),
      edges: new Float32Array(edges),
      count: positions.length / 3,
    }
  }

  function createScene(pixelData) {
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
    renderer.setClearColor(0x000000, 0)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
    renderer.setSize(800, 800, false)
    renderer.domElement.dataset.engine = `three.js r${THREE.REVISION}`
    stage.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
    camera.position.set(0, 0, 18)

    const indexArray = new Float32Array(pixelData.count)
    for (let index = 0; index < pixelData.count; index += 1) indexArray[index] = index

    const geometry = new THREE.BoxGeometry(0.06, 0.06, 0.018)
    geometry.setAttribute('aOpacity', new THREE.InstancedBufferAttribute(pixelData.opacities, 1))
    geometry.setAttribute('aIndex', new THREE.InstancedBufferAttribute(indexArray, 1))
    geometry.setAttribute(
      'aScattered',
      new THREE.InstancedBufferAttribute(pixelData.scatteredPositions, 3),
    )
    geometry.setAttribute('aEdge', new THREE.InstancedBufferAttribute(pixelData.edges, 1))

    const material = new THREE.ShaderMaterial({
      vertexShader: `
        attribute float aOpacity;
        attribute float aIndex;
        attribute float aEdge;
        attribute vec3 aScattered;

        uniform float uTime;
        uniform float uWaveSpeed;
        uniform float uWaveAmount;
        uniform vec2 uMouse;
        uniform float uMouseRadius;
        uniform float uMouseStrength;
        uniform float uMouseDistort;
        uniform float uAssembly;
        uniform float uLoose;
        uniform float uScatter;
        uniform vec3 uLightPos;
        uniform float uLightRange;
        uniform float uShadeMin;
        uniform float uShadeMax;

        varying float vOpacity;
        varying vec3 vWorldPos;
        varying float vAssembly;
        varying float vLight;

        void main() {
          vOpacity = aOpacity;
          vAssembly = uAssembly;

          vec3 targetCenter = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          vec3 localOffset = (instanceMatrix * vec4(position, 1.0)).xyz - targetCenter;
          vec3 scatteredCenter = aScattered;
          float assembly = smoothstep(0.0, 1.0, uAssembly);
          vec3 center = mix(scatteredCenter, targetCenter, assembly);
          vec3 pos = center + localOffset;
          vWorldPos = center;

          float loose = uLoose * mix(0.25, 1.0, aEdge) * assembly;
          if (loose > 0.001) {
            vec3 jitter = vec3(
              fract(sin(aIndex * 12.9898) * 43758.5453) - 0.5,
              fract(sin(aIndex * 78.2330) * 12543.1230) - 0.5,
              fract(sin(aIndex * 39.4250) * 26711.7700) - 0.5
            );
            pos += jitter * 0.05 * loose;
            pos.x += sin(uTime * 0.50 + aIndex * 0.53) * 0.06 * loose;
            pos.y += cos(uTime * 0.42 + aIndex * 0.71) * 0.06 * loose;
            pos.z += sin(uTime * 0.36 + aIndex * 0.91) * 0.08 * loose;
            float tail = smoothstep(0.5, 4.5, targetCenter.x) * uLoose * assembly;
            pos.y += sin(uTime * 1.1 - targetCenter.x * 0.7) * 0.1 * tail;
            pos.z += cos(uTime * 0.9 - targetCenter.x * 0.55) * 0.06 * tail;
          }

          if (uScatter > 0.001) {
            float disperse = uScatter * mix(0.5, 1.0, aEdge);
            pos += (scatteredCenter - center) * disperse;
            pos.z += sin(uTime * 0.6 + aIndex * 0.3) * disperse * 0.6;
          }

          if (assembly > 0.95) {
            float effectStrength = (assembly - 0.95) * 20.0;
            float dist = length(center.xy);
            float waveFade = smoothstep(0.0, 3.0, dist);
            float wave = sin(dist * 3.0 - uTime * uWaveSpeed) * uWaveAmount * effectStrength * waveFade;
            pos.z += wave;
          }

          if (assembly > 0.8) {
            float mouseEffect = (assembly - 0.8) * 5.0;
            vec2 toMouse = center.xy - uMouse;
            float mouseDist = length(toMouse);
            if (mouseDist < uMouseRadius && mouseDist > 0.001) {
              float t = 1.0 - mouseDist / uMouseRadius;
              float force = t * t * t * mouseEffect * uMouseStrength;
              vec2 radialDir = toMouse / mouseDist;
              float noiseAngle = sin(aIndex * 0.37 + uTime * 0.5) * uMouseDistort;
              float ca = cos(noiseAngle);
              float sa = sin(noiseAngle);
              vec2 pushDir = vec2(
                radialDir.x * ca - radialDir.y * sa,
                radialDir.x * sa + radialDir.y * ca
              );
              pos.xy += pushDir * force * 2.0;
              pos.z += sin(aIndex * 1.7 + uTime) * force * 0.8;
            }
          }

          if (assembly < 0.9) {
            float scatter = smoothstep(0.9, 0.0, assembly);
            pos.x += sin(uTime * 0.5 + aIndex * 0.1) * 0.2 * scatter;
            pos.y += cos(uTime * 0.4 + aIndex * 0.07) * 0.2 * scatter;
            pos.z += sin(uTime * 0.3 + aIndex * 0.13) * 0.15 * scatter;
          }

          vec4 worldPos = modelMatrix * vec4(pos, 1.0);
          float lightDist = distance(worldPos.xyz, uLightPos);
          float lit = clamp(1.0 - lightDist / uLightRange, 0.0, 1.0);
          vLight = mix(uShadeMin, uShadeMax, lit * lit);

          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying float vOpacity;
        varying vec3 vWorldPos;
        varying float vAssembly;
        varying float vLight;

        uniform float uTime;
        uniform vec3 uColor;

        void main() {
          float dist = length(vWorldPos.xy);
          float glow = smoothstep(8.0, 0.0, dist) * 0.3 * vAssembly;
          float baseAlpha = mix(0.45, 0.75, vAssembly);
          float alpha = vOpacity * (baseAlpha + glow);
          float shimmer = sin(uTime * 1.5 + vWorldPos.x * 5.0 + vWorldPos.y * 3.0) * 0.1 + 0.9;
          alpha *= shimmer * min(vLight, 1.0);
          vec3 color = (uColor + glow * vec3(0.2, 0.3, 0.5)) * vLight;
          color = mix(color, color * vec3(1.07, 1.02, 0.94), clamp(vLight - 1.0, 0.0, 1.0));
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uWaveSpeed: { value: 1.5 },
        uWaveAmount: { value: 0.06 },
        uLightPos: { value: new THREE.Vector3(lightParams.x, lightParams.y, lightParams.z) },
        uLightRange: { value: lightParams.range },
        uShadeMin: { value: lightParams.shadeMin },
        uShadeMax: { value: lightParams.shadeMax },
        uColor: { value: new THREE.Color(0.75, 0.8, 0.9) },
        uMouse: { value: new THREE.Vector2(0, 0) },
        uMouseRadius: { value: 1.5 },
        uMouseStrength: { value: 0.4 },
        uMouseDistort: { value: 0.8 },
        uAssembly: { value: 0 },
        uLoose: { value: 0 },
        uScatter: { value: 0 },
      },
    })

    const mesh = new THREE.InstancedMesh(geometry, material, pixelData.count)
    mesh.frustumCulled = false
    const dummy = new THREE.Object3D()
    for (let index = 0; index < pixelData.count; index += 1) {
      dummy.position.set(
        pixelData.positions[index * 3],
        pixelData.positions[index * 3 + 1],
        pixelData.positions[index * 3 + 2],
      )
      const scale = 0.5 + Math.random()
      dummy.scale.set(scale, scale, scale)
      dummy.updateMatrix()
      mesh.setMatrixAt(index, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true

    const group = new THREE.Group()
    group.add(mesh)
    scene.add(group)
    const inverseWorld = new THREE.Matrix4()
    const localMouse = new THREE.Vector3()
    const clock = new THREE.Clock()

    function render(timestamp) {
      window.requestAnimationFrame(render)
      if (!visible || document.hidden || timestamp - lastFrame < 1000 / 30) return
      lastFrame = timestamp

      const elapsed = clock.getElapsedTime()
      const assemblyElapsed = (performance.now() - startedAt) * 0.001 - 0.3
      const linearAssembly = Math.max(0, Math.min(1, assemblyElapsed / 2.5))
      const assembly = 1 - (1 - linearAssembly) ** 3

      if (linearAssembly <= 0) {
        group.scale.setScalar(0)
      } else {
        material.uniforms.uTime.value = elapsed
        material.uniforms.uAssembly.value = assembly
        material.uniforms.uLoose.value = 1
        material.uniforms.uScatter.value = 0
        material.uniforms.uMouseRadius.value = mouseParams.radius
        material.uniforms.uMouseDistort.value = mouseParams.distort
        material.uniforms.uLightPos.value.set(
          lightParams.x + smoothedPointer.x * lightParams.followX,
          lightParams.y,
          lightParams.z,
        )

        const targetStrength = pointer.active ? mouseParams.strength : 0
        const currentStrength = material.uniforms.uMouseStrength.value
        material.uniforms.uMouseStrength.value +=
          (targetStrength - currentStrength) * (1 - 0.05 ** (1 / 30))

        const bounds = stage.getBoundingClientRect()
        const pointerX = pointer.x * (bounds.width / bounds.height) * 8.39
        const pointerY = pointer.y * 8.39
        if (pointer.moved) {
          if (currentStrength < 0.01) {
            smoothedPointer.set(pointerX, pointerY)
          } else {
            smoothedPointer.x += (pointerX - smoothedPointer.x) * mouseParams.decay
            smoothedPointer.y += (pointerY - smoothedPointer.y) * mouseParams.decay
          }
        }

        inverseWorld.copy(group.matrixWorld).invert()
        localMouse.set(smoothedPointer.x, smoothedPointer.y, 0).applyMatrix4(inverseWorld)
        material.uniforms.uMouse.value.set(localMouse.x, localMouse.y)

        const particleColor = assembly
        material.uniforms.uColor.value.setRGB(
          0.75 * particleColor,
          0.8 * particleColor,
          0.9 * particleColor,
        )

        group.rotation.z = 0.04 * Math.sin(0.25 * elapsed)
        group.rotation.x = 0.05 * Math.sin(0.08 * elapsed * 0.7)
        group.rotation.y = 0.1 * Math.sin(0.08 * elapsed)
        group.position.y = 0.15 * Math.sin(0.4 * elapsed)
        group.scale.setScalar(0.75 + 0.25 * assembly)
      }

      renderer.render(scene, camera)
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting
      },
      { rootMargin: '100px' },
    )
    observer.observe(stage)
    window.requestAnimationFrame(render)
  }

  const image = new Image()
  image.crossOrigin = 'anonymous'
  image.addEventListener('load', () => createScene(createPixelData(image, 60)), { once: true })
  image.src = new URL('./assets/brand/hero-whale.svg', import.meta.url).href

  window.addEventListener(
    'mousemove',
    (event) => {
      pointer.active = true
      pointer.moved = true
      const bounds = stage.getBoundingClientRect()
      pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1
      pointer.y = -(((event.clientY - bounds.top) / bounds.height) * 2 - 1)
    },
    { passive: true },
  )
  window.addEventListener('mouseleave', () => {
    pointer.active = false
  })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pointer.active = false
  })
}
