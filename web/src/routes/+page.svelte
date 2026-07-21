<script lang="ts">
import { resolve } from "$app/paths";
</script>

<div class="flex-1 flex items-center justify-center">
  <div class="card bg-base-200 shadow-xl">
    <div class="card-body items-center text-center">
      <h1 class="card-title text-3xl">rhizz</h1>
      <p class="text-base-content/70">System Model Explorer</p>
      <div class="card-actions justify-center">
        <a href={resolve("/projects", {})} class="btn btn-primary">
          Projects
        </a>
      </div>
    </div>
  </div>
</div>
