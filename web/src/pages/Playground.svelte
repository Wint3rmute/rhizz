<script lang="ts">
  import { onMount } from "svelte";
  import * as THREE from "three";
  import { SVGRenderer } from "three/addons/renderers/SVGRenderer.js";

  let container: HTMLDivElement;

  function createNode(text: string, x: number, y: number): THREE.Group {
    const group = new THREE.Group();
    group.position.set(x, y, 0);

    // Bounding box
    const w = 4;
    const h = 1;
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2, -h / 2);
    shape.lineTo(w / 2, -h / 2);
    shape.lineTo(w / 2, h / 2);
    shape.lineTo(-w / 2, h / 2);
    shape.closePath();

    const fill = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      new THREE.MeshBasicMaterial({ color: "#1d232a" }),
    );
    group.add(fill);

    const edges = new THREE.EdgesGeometry(new THREE.ShapeGeometry(shape));
    const outline = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: "#3b82f6" }),
    );
    group.add(outline);

    // Store text as userData — we'll overlay it after render
    group.userData = { text, w, h };

    return group;
  }

  onMount(() => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    const aspect = w / h;
    const viewSize = 8;

    const camera = new THREE.OrthographicCamera(
      -viewSize * aspect / 2, viewSize * aspect / 2,
      viewSize / 2, -viewSize / 2,
      0.1, 100,
    );
    camera.position.z = 10;

    const scene = new THREE.Scene();

    const renderer = new SVGRenderer();
    renderer.setSize(w, h);
    container.appendChild(renderer.domElement);

    // Diagram nodes
    const nodes = [
      createNode("System", 0, 2),
      createNode("Frontend", -3, 0),
      createNode("Backend", 3, 0),
      createNode("Database", 3, -2),
    ];
    nodes.forEach((n) => scene.add(n));

    renderer.render(scene, camera);

    // Add text labels into the generated SVG
    const svg = renderer.domElement;
    for (const node of nodes) {
      const pos = new THREE.Vector3();
      node.getWorldPosition(pos);
      pos.project(camera);
      const sx = (pos.x * 0.5 + 0.5) * w;
      const sy = (-pos.y * 0.5 + 0.5) * h;

      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", String(sx));
      text.setAttribute("y", String(sy));
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("dominant-baseline", "central");
      text.setAttribute("fill", "#e0e0e0");
      text.setAttribute("font-size", "14");
      text.setAttribute("font-family", "sans-serif");
      text.setAttribute("font-weight", "bold");
      text.textContent = node.userData.text;
      svg.appendChild(text);
    }

    const onResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      const aspect = w / h;
      camera.left = -viewSize * aspect / 2;
      camera.right = viewSize * aspect / 2;
      camera.top = viewSize / 2;
      camera.bottom = -viewSize / 2;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      renderer.render(scene, camera);
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      container.removeChild(renderer.domElement);
    };
  });
</script>

<div class="h-screen w-screen flex flex-col">
  <div class="navbar bg-base-200">
    <a href="#/" class="btn btn-ghost text-xl">← rhizz</a>
    <span class="ml-2 text-sm opacity-60">Three.js Playground</span>
  </div>
  <div bind:this={container} class="flex-1 w-full bg-[#0a0a14]"></div>
</div>
