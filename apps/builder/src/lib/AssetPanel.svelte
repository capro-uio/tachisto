<script lang="ts">
  import { preloadListOf } from "tachisto-compiler";
  import { project } from "./project.svelte.ts";

  const MAX_BYTES = 5 * 1024 * 1024;

  let message = $state("");

  const assets = $derived(project.spec.assets ?? []);

  function readAsDataUrl(file: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error(`could not read ${file.name}`));
      reader.readAsDataURL(file);
    });
  }

  async function addFiles(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = "";
    const added: string[] = [];
    for (const file of files) {
      if (file.size > MAX_BYTES) {
        message = `${file.name} is larger than 5 MB, which is too big to embed in an experiment.`;
        continue;
      }
      try {
        project.spec.assets ??= [];
        const url = await readAsDataUrl(file);
        const existing = project.spec.assets.findIndex((asset) => asset.name === file.name);
        if (existing === -1) project.spec.assets.push({ name: file.name, url });
        else project.spec.assets[existing] = { name: file.name, url };
        added.push(file.name);
      } catch (error) {
        message = (error as Error).message;
      }
    }
    if (added.length > 0) message = `Added ${added.join(", ")}`;
  }

  function remove(name: string) {
    project.spec.assets = assets.filter((asset) => asset.name !== name);
    if (project.spec.assets.length === 0) delete project.spec.assets;
  }
</script>

<section>
  {#each assets as asset (asset.name)}
    <div class="asset">
      {#if preloadListOf(asset) === "video"}
        <video class="thumb" src={asset.url} muted preload="metadata"></video>
      {:else if preloadListOf(asset) === "audio"}
        <span class="thumb sound" aria-hidden="true">♪</span>
      {:else}
        <img class="thumb" src={asset.url} alt="" />
      {/if}
      <span class="name">{asset.name}</span>
      <button data-testid={`remove-asset-${asset.name}`} onclick={() => remove(asset.name)}
        >✕</button
      >
    </div>
  {/each}

  <label class="add">
    add images, sounds or video
    <input type="file" multiple data-testid="add-assets" onchange={addFiles} />
  </label>
  {#if message}<p class="muted" data-testid="asset-message">{message}</p>{/if}
</section>

<style>
  section {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .asset {
    display: flex;
    gap: 0.4rem;
    align-items: center;
  }
  .asset .thumb {
    width: 1.6rem;
    height: 1.6rem;
    object-fit: cover;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--paper-sunk);
  }
  .asset .sound {
    display: grid;
    place-items: center;
    box-sizing: border-box;
    color: var(--ink-muted);
  }
  .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .asset button {
    border: 0;
    background: none;
    color: var(--ink-muted);
    cursor: pointer;
  }
  .add {
    cursor: pointer;
    border: 1px dashed var(--line);
    border-radius: var(--radius-md);
    padding: 0.4rem;
    text-align: center;
    color: var(--ink-muted);
    font-size: 0.85rem;
  }
  .add input {
    display: none;
  }
  .muted {
    margin: 0;
    font-size: 0.8rem;
    color: var(--ink-muted);
  }
</style>
