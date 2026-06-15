// ===== THREE.JS 3D BACKGROUND =====
(function init3DScene() {
  const canvas = document.getElementById('scene-3d');
  if (!canvas || typeof THREE === 'undefined') return;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const colors = [0xf5a623, 0xe74c3c, 0x3498db, 0x2ecc71];
  const shapes = [];

  // Center glow sphere
  const glowGeo = new THREE.SphereGeometry(0.8, 16, 16);
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xf5a623, transparent: true, opacity: 0.08 });
  const glowSphere = new THREE.Mesh(glowGeo, glowMat);
  scene.add(glowSphere);

  // Floating geometric shapes
  for (let i = 0; i < 40; i++) {
    const geo = new THREE.OctahedronGeometry(0.2 + Math.random() * 0.6);
    const mat = new THREE.MeshBasicMaterial({
      color: colors[Math.floor(Math.random() * colors.length)],
      transparent: true, opacity: 0.08 + Math.random() * 0.2,
      wireframe: Math.random() > 0.4
    });
    const mesh = new THREE.Mesh(geo, mat);
    const radius = 5 + Math.random() * 15;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI * 2;
    mesh.position.set(Math.cos(theta) * Math.sin(phi) * radius, Math.sin(theta) * Math.sin(phi) * radius, Math.cos(phi) * radius);
    mesh.userData = { radius, theta, phi, speed: 0.001 + Math.random() * 0.003, rotSpeed: { x: (Math.random()-0.5)*0.01, y: (Math.random()-0.5)*0.01 } };
    scene.add(mesh);
    shapes.push(mesh);
  }

  // Orbiting ring (tilted)
  const ringPoints = [];
  const ringRadius = 6;
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    ringPoints.push(new THREE.Vector3(Math.cos(a) * ringRadius, Math.sin(a) * ringRadius * 0.3, Math.sin(a) * ringRadius * 0.5));
  }
  const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPoints);
  const ringMat = new THREE.LineBasicMaterial({ color: 0xf5a623, transparent: true, opacity: 0.12 });
  const ring = new THREE.Line(ringGeo, ringMat);
  scene.add(ring);

  // Second ring (larger, slower)
  const ringPoints2 = [];
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    ringPoints2.push(new THREE.Vector3(Math.cos(a) * 9, Math.sin(a) * 9 * 0.2, Math.sin(a) * 9 * 0.4));
  }
  const ringGeo2 = new THREE.BufferGeometry().setFromPoints(ringPoints2);
  const ringMat2 = new THREE.LineBasicMaterial({ color: 0xe74c3c, transparent: true, opacity: 0.06 });
  const ring2 = new THREE.Line(ringGeo2, ringMat2);
  scene.add(ring2);

  // Radar sweep line (a line that rotates)
  const radarPoints = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(7, 0, 0)];
  const radarGeo = new THREE.BufferGeometry().setFromPoints(radarPoints);
  const radarMat = new THREE.LineBasicMaterial({ color: 0xf5a623, transparent: true, opacity: 0.15 });
  const radarLine = new THREE.Line(radarGeo, radarMat);
  scene.add(radarLine);

  // Particles (starfield)
  const particleCount = 800;
  const particleGeo = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);
  const sizes = new Float32Array(particleCount);
  for (let i = 0; i < particleCount; i++) {
    const r = 5 + Math.random() * 25;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI * 2;
    positions[i*3] = Math.cos(theta) * Math.sin(phi) * r;
    positions[i*3+1] = Math.sin(theta) * Math.sin(phi) * r;
    positions[i*3+2] = Math.cos(phi) * r;
    sizes[i] = 0.03 + Math.random() * 0.06;
  }
  particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  particleGeo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  const particleMat = new THREE.PointsMaterial({ color: 0xf5a623, size: 0.06, transparent: true, opacity: 0.3, sizeAttenuation: true });
  const particles = new THREE.Points(particleGeo, particleMat);
  scene.add(particles);

  // Glow dots along ring path
  const dotMat = new THREE.PointsMaterial({ color: 0xf5a623, size: 0.15, transparent: true, opacity: 0.4 });
  const dotPositions = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    dotPositions.push(Math.cos(a) * ringRadius, Math.sin(a) * ringRadius * 0.3, Math.sin(a) * ringRadius * 0.5);
  }
  const dotGeo = new THREE.BufferGeometry();
  dotGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(dotPositions), 3));
  const dots = new THREE.Points(dotGeo, dotMat);
  scene.add(dots);

  camera.position.z = 14;

  let mouseX = 0, mouseY = 0, time = 0;
  document.addEventListener('mousemove', (e) => {
    mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
    mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
  });

  function animate() {
    requestAnimationFrame(animate);
    time += 0.005;

    // Orbit shapes around center
    shapes.forEach((m, i) => {
      m.userData.theta += m.userData.speed;
      m.userData.phi += m.userData.speed * 0.5;
      const r = m.userData.radius;
      m.position.x = Math.cos(m.userData.theta) * Math.sin(m.userData.phi) * r;
      m.position.y = Math.sin(m.userData.theta) * Math.sin(m.userData.phi) * r;
      m.position.z = Math.cos(m.userData.phi) * r;
      m.rotation.x += m.userData.rotSpeed.x;
      m.rotation.y += m.userData.rotSpeed.y;
    });

    // Rotate rings
    ring.rotation.y += 0.002;
    ring.rotation.x += 0.001;
    ring2.rotation.y -= 0.001;
    ring2.rotation.z += 0.0005;

    // Radar sweep
    radarLine.rotation.y += 0.02;
    radarLine.rotation.x = 0.3;

    // Rotate glow dots
    dots.rotation.y += 0.002;
    dots.rotation.x += 0.001;

    // Pulse center sphere
    const pulse = 0.8 + Math.sin(time * 2) * 0.1;
    glowSphere.scale.set(pulse, pulse, pulse);
    glowMat.opacity = 0.05 + Math.sin(time * 2) * 0.03;

    // Rotate particles slowly
    particles.rotation.y += 0.0003;
    particles.rotation.x += 0.0001;

    // Camera follow mouse
    camera.position.x += (mouseX * 1.5 - camera.position.x) * 0.015;
    camera.position.y += (-mouseY * 1.5 - camera.position.y) * 0.015;
    camera.lookAt(scene.position);

    renderer.render(scene, camera);
  }

  animate();

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
})();

// ===== 3D TILT EFFECT =====
document.querySelectorAll('.tilt-3d, .tilt-3d-glow, .feature-card, .role-card, .stat-card, .detail-main, .form-container, .login-box, .success-card, .status-result').forEach(el => {
  el.addEventListener('mousemove', (e) => {
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const rotX = (y - 0.5) * -8;
    const rotY = (x - 0.5) * 8;

    el.style.setProperty('--rotX', rotX + 'deg');
    el.style.setProperty('--rotY', rotY + 'deg');
    el.style.setProperty('--mouseX', (x * 100) + '%');
    el.style.setProperty('--mouseY', (y * 100) + '%');
  });

  el.addEventListener('mouseleave', () => {
    el.style.setProperty('--rotX', '0deg');
    el.style.setProperty('--rotY', '0deg');
  });
});

// ===== ANIMATED COUNTERS =====
function animateCounters() {
  const counters = document.querySelectorAll('.stat-num[data-target]');
  counters.forEach(counter => {
    const target = parseInt(counter.dataset.target);
    const increment = Math.ceil(target / 40);
    let current = 0;

    const update = () => {
      current += increment;
      if (current >= target) {
        counter.textContent = toKurdishNum(target) + '+';
        return;
      }
      counter.textContent = toKurdishNum(current);
      requestAnimationFrame(update);
    };
    update();
  });
}

// Convert to Kurdish (Arabic-Indic) numerals
function toKurdishNum(num) {
  const digits = '٠١٢٣٤٥٦٧٨٩';
  return String(num).split('').map(c => digits[parseInt(c)] || c).join('');
}

const heroStats = document.querySelector('.hero-stats');
if (heroStats) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        animateCounters();
        observer.disconnect();
      }
    });
  }, { threshold: 0.5 });
  observer.observe(heroStats);
}

// ===== FILE UPLOAD =====
const fileDropZone = document.getElementById('fileDropZone');
const fileInput = document.getElementById('cv');
const filePreview = document.getElementById('filePreview');
const fileName = document.getElementById('fileName');
const fileRemove = document.getElementById('fileRemove');

if (fileDropZone && fileInput) {
  fileDropZone.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      showFile(e.target.files[0].name);
    }
  });

  fileDropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    fileDropZone.classList.add('dragover');
  });

  fileDropZone.addEventListener('dragleave', () => {
    fileDropZone.classList.remove('dragover');
  });

  fileDropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    fileDropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      fileInput.files = e.dataTransfer.files;
      showFile(e.dataTransfer.files[0].name);
    }
  });

  if (fileRemove) {
    fileRemove.addEventListener('click', () => {
      fileInput.value = '';
      filePreview.style.display = 'none';
      fileDropZone.style.display = 'block';
    });
  }
}

function showFile(name) {
  if (filePreview) {
    fileName.textContent = name;
    filePreview.style.display = 'flex';
    fileDropZone.style.display = 'none';
  }
}

// ===== FORM VALIDATION =====
const applyForm = document.getElementById('applyForm');
if (applyForm) {
  applyForm.addEventListener('submit', (e) => {
    const required = applyForm.querySelectorAll('[required]');
    let valid = true;
    required.forEach(field => {
      if (!field.value.trim()) {
        field.style.borderColor = '#e74c3c';
        valid = false;
      } else {
        field.style.borderColor = '';
      }
    });
    if (!valid) {
      e.preventDefault();
      alert('تکایە هەموو خانە پێویستەکان پڕبکەرەوە.');
    }
  });
}

// ===== TABLE ROW CLICK =====
document.querySelectorAll('.players-table tbody tr').forEach(row => {
  row.addEventListener('click', (e) => {
    const viewLink = row.querySelector('.btn-view');
    if (viewLink && !e.target.closest('a')) {
      window.location.href = viewLink.href;
    }
  });
});

// ===== MOBILE MENU TOGGLE =====
(function() {
  const toggle = document.getElementById('menuToggle');
  const nav = document.getElementById('navLinks');
  const overlay = document.getElementById('navOverlay');
  if (!toggle || !nav) return;

  function closeMenu() {
    toggle.classList.remove('active');
    nav.classList.remove('open');
    if (overlay) overlay.classList.remove('show');
  }

  function openMenu() {
    toggle.classList.add('active');
    nav.classList.add('open');
    if (overlay) overlay.classList.add('show');
  }

  toggle.addEventListener('click', () => {
    if (nav.classList.contains('open')) closeMenu();
    else openMenu();
  });

  if (overlay) overlay.addEventListener('click', closeMenu);

  // Close on link click
  nav.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', closeMenu);
  });

  // Close on escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });
})();

// ===== AUTO-DISMISS ALERTS =====
document.querySelectorAll('.alert').forEach(alert => {
  setTimeout(() => {
    alert.style.opacity = '0';
    alert.style.transition = 'opacity 0.5s';
    setTimeout(() => alert.remove(), 500);
  }, 5000);
});
