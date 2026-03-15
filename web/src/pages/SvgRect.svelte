<script lang="ts">
let { id, x, y, mouse_down_handler, mouse_up_handler, mouse_move_handler, handle_clicked_on_component} = $props();

function mouse_down(e: MouseEvent) {
    e.stopPropagation();
    mouse_down_handler();
}

function mouse_up(e: MouseEvent) {
    e.stopPropagation();
    mouse_up_handler();
}

function mouse_move(e: MouseEvent) {
    mouse_move_handler(id, e);
    e.stopPropagation();
}

function handle_clicked(event: MouseEvent) {
    event.stopPropagation();
    handle_clicked_on_component(id, event);
}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<g transform="translate({x}, {y})" 

>
    <!-- Main box at local (0,0) -->
    <rect x="0" y="0" width="140" height="80" fill="black" rx="4" style="stroke-width:1;stroke:rgb(255,255,255)"
        onmousedown={mouse_down}
        onmouseup={mouse_up}
        onmousemove={mouse_move}
    />
    <text x="70" y="45" text-anchor="middle" dominant-baseline="middle"
          fill="white" font-size="14">{id}</text>

    <!-- Top (centered horizontally, sticking out above) -->
    <rect x="55" y="-15" width="30" height="15" rx="2" class="resize_handle" onclick={handle_clicked} />

    <!-- Bottom (centered horizontally, sticking out below) -->
    <rect x="55" y="80" width="30" height="15" rx="2" class="resize_handle" onclick={handle_clicked}/>

    <!-- Left (centered vertically, sticking out left) -->
    <rect x="-20" y="25" width="20" height="30" rx="2" class="resize_handle" onclick={handle_clicked}/>

    <!-- Right (centered vertically, sticking out right) -->
    <rect x="140" y="25" width="20" height="30" rx="2" class="resize_handle" onclick={handle_clicked}/>
</g>

<style>
    .resize_handle {
        opacity: 0.0;
        transition: 0.2s;
        fill: gray;
    }

    .resize_handle:hover {
        opacity: 1.0;
    }
</style>