<script>
    import { createEventDispatcher } from 'svelte';
    
    export let width = '32em';
    export let showReloadButton = false;
    export let feedFilter = 'notes';
    
    const dispatch = createEventDispatcher();
    
    function handleReload() {
        // Dispatch reload event to parent component
        const event = new CustomEvent('reload');
        document.dispatchEvent(event);
    }
    
    function handleFilterChange(filter) {
        dispatch('filterChange', filter);
    }
</script>

<div class="vertical-column" style="width: {width}">
    <div class="column-header">
        <div class="filter-buttons">
            <button class="filter-btn" 
                    class:active={feedFilter === 'notes'} 
                    on:click={() => handleFilterChange('notes')}>
                Notes
            </button>
            <button class="filter-btn" 
                    class:active={feedFilter === 'replies'} 
                    on:click={() => handleFilterChange('replies')}>
                Replies
            </button>
            <button class="filter-btn" 
                    class:active={feedFilter === 'reposts'} 
                    on:click={() => handleFilterChange('reposts')}>
                Reposts
            </button>
        </div>
        {#if showReloadButton}
            <button class="reload-btn" on:click={handleReload} title="Reload feed">↺</button>
        {/if}
    </div>
    <div class="column-content">
        <slot />
    </div>
</div>

<style>
    .vertical-column {
        display: flex;
        flex-direction: column;
        height: 100vh;
        background-color: var(--bg-color);
        border-radius: 0;
        box-shadow: none;
        margin: 0;
        overflow: hidden;
        width: 32em;
        max-width: 32em;
        min-width: 0;
        flex-shrink: 1;
        flex-grow: 0;
    }

    .column-header {
        padding: 0;
        margin:0;
        display: flex;
        justify-content: space-between;
        align-items: sta;
        border-bottom: 1px solid var(--primary);
    }

    .filter-buttons {
        display: flex;
    }

    .filter-btn {
        background: none;
        border: none;
        padding-right: 0.5em;
        padding-left: 0.5em;
        padding-top: 0;
        padding-bottom: 0;
        margin:0;
        cursor: pointer;
        color: var(--text-color);
        font-size: 0.9rem;
        font-weight: 500;
        transition: all 0.2s;
    }

    .filter-btn:hover {
        background-color: var(--button-hover-bg);
    }

    .filter-btn.active {
        color: var(--text-color);
        border-bottom: 0.25em solid var(--primary);
    }

    .reload-btn {
        background: none;
        border: none;
        font-size: 1.5em;
        margin:0;
        cursor: pointer;
        color: var(--text-color);
        transition: background-color 0.2s;
    }

    .reload-btn:hover {
        background-color: var(--button-hover-bg);
    }

    .column-content {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 0;
        height: calc(100vh - 4rem); /* Subtract header height */
    }

    /* Custom scrollbar styling */
    .column-content::-webkit-scrollbar {
        width: 8px;
    }

    .column-content::-webkit-scrollbar-track {
        background: var(--bg-color);
        border-radius: 4px;
    }

    .column-content::-webkit-scrollbar-thumb {
        background: var(--border-color);
        border-radius: 4px;
    }

    .column-content::-webkit-scrollbar-thumb:hover {
        background: var(--text-color);
    }

    /* Firefox scrollbar styling */
    .column-content {
        scrollbar-width: thin;
        scrollbar-color: var(--border-color) var(--bg-color);
    }

    /* Mobile responsive */
    @media (max-width: 768px) {
        .vertical-column {
            width: 28em;
            max-width: 28em;
        }
    }

    @media (max-width: 480px) {
        .vertical-column {
            width: 24em;
            max-width: 24em;
        }
    }
</style>
