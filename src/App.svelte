<script>
    export let name;

    let isDarkTheme = false;
    let isLogoHovered = false;

    // Load theme preference from localStorage on component initialization
    if (typeof localStorage !== 'undefined') {
        const savedTheme = localStorage.getItem('isDarkTheme');
        if (savedTheme !== null) {
            isDarkTheme = JSON.parse(savedTheme);
        }
    }

    function toggleTheme() {
        isDarkTheme = !isDarkTheme;
        // Save theme preference to localStorage
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('isDarkTheme', JSON.stringify(isDarkTheme));
        }
    }

    function handleLogoMouseEnter() {
        isLogoHovered = true;
    }

    function handleLogoMouseLeave() {
        isLogoHovered = false;
    }

    $: if (typeof document !== 'undefined') {
        if (isDarkTheme) {
            document.body.classList.add('dark-theme');
        } else {
            document.body.classList.remove('dark-theme');
        }
    }
</script>

<!-- Header -->
<header class="main-header" class:dark-theme={isDarkTheme}>
    <div class="header-content">
        <img 
            src={isLogoHovered ? "/orly-favicon.png" : "/orly.png"} 
            alt="Orly Logo" 
            class="logo"
            on:mouseenter={handleLogoMouseEnter}
            on:mouseleave={handleLogoMouseLeave}
        />
        <div class="header-title">
            <span class="app-title">
                Git.Nostrly.App
            </span>
        </div>
        <button class="theme-toggle-btn" on:click={toggleTheme}>
            {isDarkTheme ? '☀️' : '🌙'}
        </button>
    </div>
</header>

<!-- Main Content Area -->
<div class="app-container" class:dark-theme={isDarkTheme}>
    <!-- Main Content -->
    <main class="main-content">
        <h1>Hello {name}!</h1>
        <p>Welcome to Git.Nostrly.App - A Nostr client application.</p>
    </main>
</div>


<style>
    :global(body) {
        margin: 0;
        padding: 0;
        --bg-color: #ddd;
        --header-bg: #eee;
        --border-color: #dee2e6;
        --text-color: #444444;
        --input-border: #ccc;
        --button-bg: #ddd;
        --button-hover-bg: #eee;
        --primary: #00BCD4;
        --warning: #ff3e00;
    }

    :global(body.dark-theme) {
        --bg-color: #263238;
        --header-bg: #1e272c;
        --border-color: #404040;
        --text-color: #ffffff;
        --input-border: #555;
        --button-bg: #263238;
        --button-hover-bg: #1e272c;
        --primary: #00BCD4;
        --warning: #ff3e00;
    }

    /* Header Styles */
    .main-header {
        height: 3em;
        background-color: var(--header-bg);
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 1000;
        color: var(--text-color);
    }

    .header-content {
        height: 100%;
        display: flex;
        align-items: center;
        padding: 0;
        gap: 0;
    }

    .logo {
        height: 2.5em;
        width: 2.5em;
        object-fit: contain;
        flex-shrink: 0;
        transition: opacity 0.2s ease;
        cursor: pointer;
    }

    .header-title {
        flex: 1;
        height: 100%;
        display: flex;
        align-items: center;
        padding: 0 1rem;
    }

    .app-title {
        font-size: 1em;
        font-weight: 600;
        color: var(--text-color);
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .theme-toggle-btn {
        border: 0 none;
        border-radius: 0;
        display: flex;
        align-items: center;
        background-color: var(--button-hover-bg);
        cursor: pointer;
        color: var(--text-color);
        height: 3em;
        width: auto;
        min-width: 3em;
        flex-shrink: 0;
        line-height: 1;
        transition: background-color 0.2s;
        justify-content: center;
        padding: 1em 1em 1em 1em;
        margin: 0;
    }

    .theme-toggle-btn:hover {
        background-color: var(--button-bg);
    }


    /* App Container */
    .app-container {
        display: flex;
        margin-top: 3em;
        height: calc(100vh - 3em);
    }

    /* Main Content */
    .main-content {
        flex: 1;
        padding: 2rem;
        overflow-y: auto;
        background-color: var(--bg-color);
        color: var(--text-color);
    }

    .main-content h1 {
        color: #ff3e00;
        text-transform: uppercase;
        font-size: 4em;
        font-weight: 100;
        text-align: center;
    }

    .main-content p {
        text-align: center;
        font-size: 1.2em;
        color: var(--text-color);
    }

    @media (max-width: 640px) {
        .header-content {
            padding: 0;
        }

        .main-content {
            padding: 1rem;
        }

        .main-content h1 {
            font-size: 2.5em;
        }
    }
    
    
</style>