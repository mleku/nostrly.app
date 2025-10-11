<script>
    import { onMount, afterUpdate } from 'svelte';
    import LoginModal from './LoginModal.svelte';
    import { getNDK, fetchUserProfile, fetchUserRelayList, initializeNostrClient, nostrClient } from './nostr.js';
    
    let isDarkTheme = false;
    let isLogoHovered = false;
    let showLoginModal = false;
    let isLoggedIn = false;
    let userPubkey = '';
    let userProfile = null;
    let showSettingsDrawer = false;
    let ndk = null;
    let isExpanded = false;
    let profileFetchAttempted = false;
    let activeView = 'global'; // 'welcome' or 'global'
    let columnCount = 1; // Number of columns displayed
    let foldedBoxes = []; // Array of folded box indices

    // Load theme preference from localStorage on component initialization
    if (typeof localStorage !== 'undefined') {
        const savedTheme = localStorage.getItem('isDarkTheme');
        if (savedTheme !== null) {
            isDarkTheme = JSON.parse(savedTheme);
        }
        
        // Check for existing authentication
        const storedAuthMethod = localStorage.getItem('nostr_auth_method');
        const storedPubkey = localStorage.getItem('nostr_pubkey');
        
        if (storedAuthMethod && storedPubkey) {
            isLoggedIn = true;
            userPubkey = storedPubkey;
            // Note: Profile will be fetched when NDK is available
        }
    }

    // Initialize NDK and fetch profile on mount
    async function initializeApp() {
        try {
            await initializeNostrClient();
            ndk = getNDK();
            
            // If user is logged in, fetch their profile
            if (isLoggedIn && userPubkey) {
                profileFetchAttempted = true;
                try {
                    console.log('Fetching profile on initialization for user:', userPubkey);
                    const profile = await fetchUserProfile(userPubkey);
                    userProfile = profile; // Trigger reactivity
                } catch (error) {
                    console.error('Failed to fetch user profile:', error);
                    profileFetchAttempted = false; // Allow retry on error
                }
            }
        } catch (error) {
            console.error('Failed to initialize NDK:', error);
        }
    }

    // Auto-fetch profile when user button loads without avatar/username
    async function checkAndFetchProfile() {
        if (isLoggedIn && userPubkey && ndk && !profileFetchAttempted && (!userProfile || !userProfile.picture || !userProfile.name)) {
            profileFetchAttempted = true;
            try {
                console.log('Auto-fetching profile for user:', userPubkey);
                const profile = await fetchUserProfile(userPubkey);
                userProfile = profile; // Trigger reactivity
            } catch (error) {
                console.error('Failed to auto-fetch user profile:', error);
                profileFetchAttempted = false; // Allow retry on error
            }
        }
    }

    // Check for profile on mount and after updates
    onMount(() => {
        initializeApp();
    });

    // Only check for profile after updates if we're logged in but don't have profile data
    afterUpdate(() => {
        if (isLoggedIn && userPubkey && (!userProfile || !userProfile.picture || !userProfile.name)) {
            checkAndFetchProfile();
        }
    });

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

    function openLoginModal() {
        showLoginModal = true;
    }

    function closeLoginModal() {
        showLoginModal = false;
    }

    async function handleLogin(event) {
        // Handle login event from modal
        console.log('Login event:', event.detail);
        const { method, pubkey, signer } = event.detail;
        
        isLoggedIn = true;
        userPubkey = pubkey;
        ndk = getNDK();
        profileFetchAttempted = false; // Reset flag for new login
        
        // Set the signer on NDK if available
        if (ndk && signer) {
            ndk.signer = signer;
        }
        
        // Store authentication info
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('nostr_auth_method', method);
            localStorage.setItem('nostr_pubkey', pubkey);
        }
        
        // Fetch user relay list and connect to user's relays
        try {
            console.log('Fetching user relay list...');
            const relayList = await fetchUserRelayList(pubkey);
            console.log('User relay list:', relayList);
            
            if (relayList && relayList.length > 0) {
                console.log('Connecting to user relays...');
                await nostrClient.connectToUserRelays(relayList);
            } else {
                console.log('No user relays found, keeping default relays');
            }
        } catch (error) {
            console.error('Failed to fetch user relay list:', error);
            // Continue with default relays if user relay fetch fails
        }
        
        // Fetch user profile
        try {
            const profile = await fetchUserProfile(pubkey);
            userProfile = profile; // Trigger reactivity
        } catch (error) {
            console.error('Failed to fetch user profile after login:', error);
        }
        
        closeLoginModal();
    }

    async function handleLogout() {
        isLoggedIn = false;
        userPubkey = '';
        userProfile = null;
        showSettingsDrawer = false;
        ndk = null;
        profileFetchAttempted = false; // Reset flag for logout
        
        // Clear stored authentication
        if (typeof localStorage !== 'undefined') {
            localStorage.removeItem('nostr_auth_method');
            localStorage.removeItem('nostr_pubkey');
            localStorage.removeItem('nostr_privkey');
        }
        
        // Reconnect to default relays
        try {
            console.log('Reconnecting to default relays after logout...');
            await nostrClient.connect();
        } catch (error) {
            console.error('Failed to reconnect to default relays:', error);
        }
    }

    function openSettingsDrawer() {
        showSettingsDrawer = true;
    }

    function closeSettingsDrawer() {
        showSettingsDrawer = false;
    }

    function toggleExpander() {
        isExpanded = !isExpanded;
    }

    function switchToGlobalView() {
        activeView = 'global';
    }

    function switchToWelcomeView() {
        activeView = 'welcome';
    }

    function addColumn() {
        columnCount += 1;
    }

    function removeColumn(index) {
        if (columnCount > 1) {
            // Close all columns to the right of the clicked column
            columnCount = index;
            
            // If the column to the left is folded, unfold it
            if (index > 0 && foldedBoxes.includes(index - 1)) {
                unfoldFromBox(index - 1);
            }
        }
    }

    function foldBoxes(index) {
        // Don't fold if this is the rightmost column and there are no columns to the right
        if (index === columnCount - 1) {
            console.log('Cannot fold rightmost column - no columns to the right');
            return;
        }
        
        // Fold all boxes from 0 to index (inclusive)
        const newFoldedBoxes = [];
        for (let i = 0; i <= index; i++) {
            if (!foldedBoxes.includes(i)) {
                newFoldedBoxes.push(i);
            }
        }
        foldedBoxes = [...foldedBoxes, ...newFoldedBoxes];
    }

    function unfoldFromBox(index) {
        // Unfold from index onwards (including index)
        foldedBoxes = foldedBoxes.filter(i => i < index);
    }


    $: if (typeof document !== 'undefined') {
        if (isDarkTheme) {
            document.body.classList.add('dark-theme');
        } else {
            document.body.classList.remove('dark-theme');
        }
    }

    // Reactive statement to trigger updates when profile changes
    $: if (userProfile) {
        console.log('Profile updated:', userProfile);
    }
</script>

<!-- Header -->
<header class="main-header" class:dark-theme={isDarkTheme} class:expanded={isExpanded}>
    <div class="header-content">
        <!-- Top Section: Logo and ORLY text (top-left justified) -->
        <div class="top-section">
            <div class="logo-section" class:expanded={isExpanded}>
                <img 
                    src={isLogoHovered ? "/orly-favicon.png" : "/orly.png"} 
                    alt="Orly Logo" 
                    class="logo"
                    on:mouseenter={handleLogoMouseEnter}
                    on:mouseleave={handleLogoMouseLeave}
                />
            </div>
            <div class="logo-section" class:expanded={isExpanded}>
                <span class="orly-text">ORLY?</span>
            </div>
        </div>
        
        <!-- Middle Section: Global and User login/avatar (centered vertically) -->
        <div class="middle-section">
            <!-- Global Button -->
            <div class="user-info">
                <div class="tab-container" class:active={activeView === 'global'}>
                    {#if activeView === 'global' && !isExpanded}
                        <div class="vertical-label">Global</div>
                    {/if}
                    <button class="user-profile-btn" class:expanded={isExpanded} class:active={activeView === 'global'} on:click={switchToGlobalView} title={isExpanded ? '' : 'Global'}>
                        <div class="user-avatar-placeholder">🌍</div>
                        <span class="user-name">Global</span>
                    </button>
                </div>
            </div>
            
            <!-- User Button -->
            {#if isLoggedIn}
                <div class="user-info">
                    <div class="tab-container" class:active={activeView === 'welcome'}>
                        {#if activeView === 'welcome' && !isExpanded}
                            <div class="vertical-label">User</div>
                        {/if}
                        <button class="user-profile-btn" class:expanded={isExpanded} class:active={activeView === 'welcome'} on:click={openSettingsDrawer} title={isExpanded ? '' : (userProfile?.name || userPubkey.slice(0, 8) + '...')}>
                            {#if userProfile?.picture}
                                <img src={userProfile.picture} alt="User avatar" class="user-avatar" />
                            {:else}
                                <div class="user-avatar-placeholder">👤</div>
                            {/if}
                            <span class="user-name">
                                {userProfile?.name || userPubkey.slice(0, 8) + '...'}
                            </span>
                        </button>
                    </div>
                </div>
            {:else}
                <div class="user-info">
                    <div class="tab-container" class:active={activeView === 'welcome'}>
                        {#if activeView === 'welcome' && !isExpanded}
                            <div class="vertical-label">Login</div>
                        {/if}
                        <button class="login-btn" class:expanded={isExpanded} class:active={activeView === 'welcome'} on:click={openLoginModal} title={isExpanded ? '' : 'Log in'}>🔑<span class="login-text"> Log in</span></button>
                    </div>
                </div>
            {/if}
        </div>
        
        <!-- Bottom Section: Expander button (left-top justified) -->
        <div class="bottom-section">
            <div class="control-buttons-container">
                <button class="expander-btn" on:click={toggleExpander}>
                    {isExpanded ? '◀' : '▶'}
                </button>
            </div>
        </div>
    </div>
</header>

<!-- Main Content Area -->
<div class="app-container" class:dark-theme={isDarkTheme} class:expanded={isExpanded}>
    <!-- Main Content -->
    <main class="main-content">
        {#if activeView === 'global'}
            <div class="global-container">
                <!-- Folded Boxes Column -->
                {#if foldedBoxes.length > 0}
                    <div class="folded-column">
                        {#each foldedBoxes as foldedIndex}
                            <button class="folded-title-btn" on:click={() => unfoldFromBox(foldedIndex)}>
                                {foldedIndex + 1}
                            </button>
                        {/each}
                    </div>
                {/if}
                
                <!-- Active Boxes -->
                {#each Array(columnCount) as _, index}
                    {#if !foldedBoxes.includes(index)}
                        <div class="content-box">
                            <div class="box-header">
                                <button class="title-btn" class:disabled={index === columnCount - 1} on:click={() => foldBoxes(index)}>
                                    <h3>{index + 1}</h3>
                                </button>
                                <div class="box-controls">
                                    {#if index === columnCount - 1}
                                        <button class="control-btn add-btn" on:click={addColumn}>+</button>
                                    {/if}
                                    {#if columnCount > 1 && index > 0}
                                        <button class="control-btn remove-btn" on:click={() => removeColumn(index)}>-</button>
                                    {/if}
                                </div>
                            </div>
                            <p>This is dummy content for box {index + 1}. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p>
                            <p>Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.</p>
                            <p>Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium.</p>
                            <p>Totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo. Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit.</p>
                            <p>Sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt. Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet, consectetur, adipisci velit.</p>
                            <p>Sed quia non numquam eius modi tempora incidunt ut labore et dolore magnam aliquam quaerat voluptatem. Ut enim ad minima veniam, quis nostrum exercitationem ullam corporis suscipit laboriosam.</p>
                            <p>Nisi ut aliquid ex ea commodi consequatur? Quis autem vel eum iure reprehenderit qui in ea voluptate velit esse quam nihil molestiae consequatur.</p>
                            <p>At vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis praesentium voluptatum deleniti atque corrupti quos dolores et quas molestias excepturi sint occaecati cupiditate non provident.</p>
                            <p>Similique sunt in culpa qui officia deserunt mollitia animi, id est laborum et dolorum fuga. Et harum quidem rerum facilis est et expedita distinctio.</p>
                            <p>Nam libero tempore, cum soluta nobis est eligendi optio cumque nihil impedit quo minus id quod maxime placeat facere possimus, omnis voluptas assumenda est, omnis dolor repellendus.</p>
                        </div>
                    {/if}
                {/each}
            </div>
        {:else}
            <p>Welcome to nostrly.app - A Nostr client application.</p>
        {/if}
    </main>
</div>

<!-- Settings Drawer -->
{#if showSettingsDrawer}
    <div class="drawer-overlay" on:click={closeSettingsDrawer} on:keydown={(e) => e.key === 'Escape' && closeSettingsDrawer()} role="button" tabindex="0">
        <div class="settings-drawer" class:dark-theme={isDarkTheme} on:click|stopPropagation on:keydown|stopPropagation>
            <div class="drawer-header">
                <h2>Settings</h2>
                <button class="close-btn" on:click={closeSettingsDrawer}>✕</button>
            </div>
            <div class="drawer-content">
                {#if userProfile}
                    <div class="profile-section">
                        <div class="profile-hero">
                            {#if userProfile.banner}
                                <img src={userProfile.banner} alt="Profile banner" class="profile-banner" />
                            {/if}
                            <!-- Avatar overlaps the bottom edge of the banner by 50% -->
                            {#if userProfile.picture}
                                <img src={userProfile.picture} alt="User avatar" class="profile-avatar overlap" />
                            {:else}
                                <div class="profile-avatar-placeholder overlap">👤</div>
                            {/if}
                            <!-- Username and nip05 to the right of the avatar, above the bottom edge -->
                            <div class="name-row">
                                <h3 class="profile-username">{userProfile.name || 'Unknown User'}</h3>
                                {#if userProfile.nip05}
                                    <span class="profile-nip05-inline">{userProfile.nip05}</span>
                                {/if}
                            </div>
                        </div>

                        <!-- About text in a box underneath, with avatar overlapping its top edge -->
                        {#if userProfile.about}
                            <div class="about-card">
                                <p class="profile-about">{userProfile.about}</p>
                            </div>
                        {/if}
                    </div>
                {/if}
                
                <div class="settings-actions">
                    <div class="theme-toggle-section">
                        <span class="theme-toggle-label">Theme:</span>
                        <button class="theme-toggle-btn" on:click={toggleTheme} aria-label="Toggle theme">
                            {isDarkTheme ? '☀️ Light' : '🌙 Dark'}
                        </button>
                    </div>
                    <button class="logout-btn" on:click={handleLogout}>Log out</button>
                </div>
            </div>
        </div>
    </div>
{/if}

<!-- Login Modal -->
<LoginModal 
    bind:showModal={showLoginModal}
    {isDarkTheme}
    on:login={handleLogin}
    on:close={closeLoginModal}
/>

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
        --tab-hover-bg: #f0f0f0;
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
        --tab-hover-bg: #37474f;
    }

    /* Header Styles */
    .main-header {
        width: 3em;
        background-color: var(--header-bg);
        position: fixed;
        top: 0;
        left: 0;
        bottom: 0;
        z-index: 1000;
        color: var(--text-color);
        transition: width 0.3s ease;
        margin: 0;
        padding: 0;
    }

    .main-header.expanded {
        width: 12em;
    }

    .main-header.expanded .header-content {
        align-items: flex-start;
    }

    .main-header.expanded .logo-section {
        align-items: flex-start;
    }


    .main-header.expanded .user-info {
        justify-content: flex-start;
    }

    .main-header.expanded .user-profile-btn {
        align-items: flex-start;
    }

    .main-header.expanded .login-btn {
        justify-content: flex-start;
        padding:0.5em;
    }

    .main-header.expanded .expander-btn {
        justify-content: center;
    }


    /* Collapsed mode styles - no backgrounds, centered */

    .main-header:not(.expanded) .user-profile-btn {
        background-color: transparent;
    }

    .main-header:not(.expanded) .user-profile-btn:hover {
        background-color: transparent;
    }

    .main-header:not(.expanded) .login-btn {
        background-color: transparent;
        color: var(--text-color);
    }

    .main-header:not(.expanded) .login-btn:hover {
        background-color: transparent;
    }

    .main-header:not(.expanded) .login-text {
        display: none;
    }

    .login-text{
        padding:0.5em;
    }

    .main-header:not(.expanded) .expander-btn {
        padding: 0.5em 0.4em 0.5em 1em;
    }

    .main-header:not(.expanded) .expander-btn:hover {
        background-color: var(--button-hover-bg);
    }

    .main-header:not(.expanded) .user-name {
        display: none;
    }

    .header-content {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        padding: 0;
        gap: 0.5em;
    }

    .main-header.expanded .header-content {
        flex-direction: column;
        align-items: flex-start;
        justify-content: space-between;
        gap: 0.5em;
    }

    .top-section {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        justify-content: flex-start;
        margin: 0;
        padding:0;
        width: 100%;
    }

    .main-header.expanded .top-section {
        flex-direction: row;
        align-items: center;
        justify-content: flex-start;
        gap: 0.5em;
        margin-top: 0;
        width: 100%;
    }

    .middle-section {
        display: flex;
        flex-direction: column;
        align-items: end;
        justify-content: end;
        flex: 2;
        width: 100%;
        height:100%;
    }

    .main-header.expanded .middle-section {
        width: 100%;
    }


    .bottom-section {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        justify-content: flex-end;
        margin: 0em;
        width: 100%;
        padding: 0;
        flex: 0 0 auto;
    }
    
    .control-buttons-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-end;
        width: 100%;
        margin:0;
        padding:0;
    }
    
    .main-header.expanded .control-buttons-container {
        align-items: flex-end;
        justify-content: flex-end;
    }

    .main-header.expanded .bottom-section {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        justify-content: flex-end;
        margin-bottom: 0;
        width: 100%;
        padding-left: 0;
        flex: 0 0 auto;
    }

    .logo-section {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        margin: 0;
    }

    .main-header.expanded .logo-section {
        flex-direction: row;
        align-items: center;
        justify-content: flex-start;
        gap: 0.5em;
    }

    .logo {
        height: 2.5em;
        width: 2.5em;
        object-fit: contain;
        flex-shrink: 0;
        transition: opacity 0.2s ease;
        cursor: pointer;
        position: relative;
        z-index: 1;
    }

    .orly-text {
        font-family: 'Impact', 'Arial Black', sans-serif;
        font-size: 1.75em;
        font-weight: bold;
        color: var(--text-color);
        writing-mode: vertical-rl;
        text-orientation: mixed;
        transform: rotate(180deg);
        white-space: nowrap;
        letter-spacing: 0.1em;
        user-select: none;
        margin: 0;
        transition: all 0.3s ease;
        flex-shrink: 0;
        padding-top:0.5em;
    }

    .main-header.expanded .orly-text {
        writing-mode: horizontal-tb;
        text-orientation: initial;
        transform: rotate(360deg);
        font-size: 1.5em;
        flex-shrink: 0;
        margin: 0;
    }


    .login-btn {
        padding: 0;
        border: none;
        border-radius: 0;
        background-color: var(--tab-hover-bg);
        color: var(--text-color);
        cursor: pointer;
        font-size: 1em;
        font-weight: 500;
        transition: background-color 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0;
        width: 100%;
        height: 3em;
        white-space: nowrap;
        align-self: flex-start;
    }

    .login-btn:hover {
        background-color: #0097A7;
    }

    .expander-btn {
        border: 0 none;
        border-radius: 0;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        background-color: var(--button-hover-bg);
        cursor: pointer;
        color: var(--text-color);
        width: 100%;
        transition: background-color 0.2s;
        font-size: 2em;
        margin: 0;
        padding-left: 4em;
        padding-right: 1em;
        padding-top: 0.5em;
        padding-bottom: 0.5em;
    }

    .expander-btn:hover {
        background-color: var(--button-bg);
    }

    /* User Info Styles */
    .user-info {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        width: 100%;
    }

    .tab-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        width: 100%;
        position: relative;
    }

    .tab-container.active {
        background-color: var(--bg-color);
        border-radius: 8px 0 0 8px;
        margin-right: -1px;
        padding: 0.5em 0.5em 0.5em 0;
    }

    .vertical-label {
        writing-mode: vertical-rl;
        text-orientation: mixed;
        transform: rotate(180deg);
        font-size: 0.8em;
        font-weight: 600;
        color: var(--text-color);
        margin-bottom: 0.5em;
        white-space: nowrap;
        letter-spacing: 0.1em;
    }
    
    .user-profile-btn {
        border: 0 none;
        border-radius: 0;
        display: flex;
        flex-direction: column;
        align-items: start;
        background-color: var(--button-hover-bg);
        cursor: pointer;
        color: var(--text-color);
        width: 100%;
        padding: 0;
        margin: 0;
        transition: background-color 0.2s;
        font-size: 1em;
        height: 3em;
    }

    .user-profile-btn.expanded {
        flex-direction: row;
        width: 100%;
        align-items: center;
        justify-content: flex-start;
    }
    
    .user-profile-btn:hover {
        background-color: var(--button-bg);
    }
    
    .user-avatar, .user-avatar-placeholder {
        width: 2em;
        height: 2em;
        border-radius: 50%;
        object-fit: cover;
        flex-shrink: 0;
        padding:0.5em;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    
    .user-avatar-placeholder {
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-size: 1em;
    }
    
    .user-name {
        font-size: 2em;
        width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        height: 2em;
        display: flex;
        align-items: center;
        justify-content: flex-start;
    }

    .user-profile-btn.expanded .user-name {
        font-size: 1em;
        padding:0.5em;
        margin:0;
        text-align: left;
        flex: 1;
    }

    .user-profile-btn.active {
        background-color: var(--primary);
        color: white;
    }

    .login-btn.active {
        background-color: var(--primary);
        color: white;
    }



    /* App Container */
    .app-container {
        display: flex;
        height: 100vh;
        width: 100vw;
        position: fixed;
        top: 0;
        left: 0;
    }

    /* Main Content */
    .main-content {
        flex: 1;
        padding: 2rem;
        overflow-y: auto;
        overflow-x: hidden;
        background-color: var(--bg-color);
        color: var(--text-color);
        margin-left: 3em;
        transition: margin-left 0.3s ease;
        width: calc(100vw - 3em);
    }

    .app-container.expanded .main-content {
        margin-left: 12em;
        width: calc(100vw - 12em);
    }


    .main-content p {
        text-align: center;
        font-size: 1.2em;
        color: var(--text-color);
    }

    /* Global Container */
    .global-container {
        display: flex;
        flex-direction: row;
        height: 100%;
        overflow-x: auto;
        overflow-y: hidden;
    }

    .content-box {
        flex: 1 1 0;
        min-width: 0;
        max-width: 32em;
        border: none;
        padding: 1em;
        background-color: var(--bg-color);
        overflow-y: auto;
        overflow-x: hidden;
        max-height: calc(100vh - 4rem);
    }

    .box-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1rem;
        border-bottom: 1px solid var(--border-color);
        padding-bottom: 0.5rem;
    }

    .content-box h3 {
        margin: 0;
        color: var(--text-color);
        font-size: 1.2rem;
        font-weight: 600;
    }

    .box-controls {
        display: flex;
        gap: 0.25rem;
    }

    .control-btn {
        width: 1.5rem;
        height: 1.5rem;
        border: 1px solid var(--border-color);
        border-radius: 4px;
        background-color: var(--button-bg);
        color: var(--text-color);
        cursor: pointer;
        font-size: 0.8rem;
        font-weight: bold;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background-color 0.2s;
    }

    .control-btn:hover {
        background-color: var(--button-hover-bg);
    }

    .add-btn:hover {
        background-color: var(--primary);
        color: white;
    }

    .remove-btn:hover {
        background-color: var(--warning);
        color: white;
    }

    .title-btn {
        background: none;
        border: none;
        padding: 0;
        margin: 0;
        cursor: pointer;
        text-align: left;
    }

    .title-btn:hover h3 {
        color: var(--primary);
    }

    .title-btn.disabled {
        cursor: not-allowed;
        opacity: 0.5;
    }

    .title-btn.disabled:hover h3 {
        color: var(--text-color);
    }

    .folded-column {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        margin-right: 1rem;
        width: 3rem;
    }

    .folded-title-btn {
        padding: 0.5rem 1rem;
        border: 1px solid var(--border-color);
        border-radius: 4px;
        background-color: var(--button-bg);
        color: var(--text-color);
        cursor: pointer;
        font-size: 0.9rem;
        font-weight: 500;
        text-align: left;
        transition: background-color 0.2s;
        height: 2.5rem;
        display: flex;
        align-items: center;
        justify-content: flex-start;
        white-space: nowrap;
    }

    .folded-title-btn:hover {
        background-color: var(--button-hover-bg);
    }

    .content-box p {
        margin: 0 0 1rem 0;
        color: var(--text-color);
        line-height: 1.6;
        text-align: left;
        font-size: 0.9rem;
    }

    .content-box p:last-child {
        margin-bottom: 0;
    }


    @media (max-width: 640px) {
        .main-header {
            width: 4em;
        }
        
        .main-header.expanded {
            width: 6em;
        }
        
        .main-content {
            margin-left: 3em;
            width: calc(100vw - 3em);
        }
        
        .app-container.expanded .main-content {
            margin-left: 6em;
            width: calc(100vw - 6em);
        }
        
        .header-content {
            padding: 0;
            margin:0;
        }

        .main-header.expanded .header-content {
            flex-direction: column;
            gap: 0.5em;
        }

        .main-header.expanded .top-section {
            flex-direction: column;
            align-items: flex-start;
            gap: 0.2em;
            margin-top: 0.5em;
        }

        .main-header.expanded .middle-section {
            align-items: center;
            justify-content: center;
        }

        .main-header.expanded .bottom-section {
            margin: 0;
            width: 100%;
            padding: 0;
        }
        
        .main-header.expanded .control-buttons-container {
            align-items: flex-start;
            justify-content: flex-start;
        }

        .main-content {
            padding: 1rem;
        }
        
        .logo-section {
            margin: 0.2em 0;
        }
        
        .logo {
            height: 2em;
            width: 2em;
        }
        
        .orly-text {
            font-size: 1em;
        }
        
        .user-profile-btn {
            width: 2.5em;
            height: 2.5em;
            font-size: 0.5em;
        }
        
        .user-avatar, .user-avatar-placeholder {
            width: 2em;
            height: 2em;
        }
        
        .user-name {
            font-size: 1em;
        }
        
        
        .login-btn {
            width: 3em;
            height: 3em;
            padding:0.5em;
            margin:0;
            font-size: 0.5em;
        }
        
        .expander-btn {
            width: 100%;
        }

        .global-container {
            padding: 0;
            gap: 0;
        }

        .content-box {
            flex: 0 0 250px;
            padding: 0.75rem;
            max-height: calc(100vh - 2rem);
        }

    }

    /* Settings Drawer */
    .drawer-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        z-index: 1000;
        display: flex;
        justify-content: flex-start;
    }
    
    .settings-drawer {
        width: 640px;
        height: 100%;
        background: var(--bg-color);
        overflow-y: auto;
        animation: slideInLeft 0.3s ease;
    }
    
    @keyframes slideInLeft {
        from { transform: translateX(-100%); }
        to { transform: translateX(0); }
    }
    
    .drawer-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: var(--header-bg);
        padding: 1rem;
        border-bottom: 1px solid var(--border-color);
    }
    
    .drawer-header h2 {
        margin: 0;
        color: var(--text-color);
        font-size: 1.2rem;
        font-weight: 600;
    }
    
    .close-btn {
        background: none;
        border: none;
        font-size: 1.2rem;
        cursor: pointer;
        color: var(--text-color);
        padding: 0.25rem;
        border-radius: 4px;
        transition: background-color 0.2s;
    }
    
    .close-btn:hover {
        background: var(--button-hover-bg);
    }
    
    .drawer-content {
        padding: 1.5rem;
    }
    
    .profile-section {
        margin-bottom: 2rem;
    }

    .profile-hero {
        position: relative;
        margin-bottom: 1rem;
    }
    
    .profile-banner {
        width: 100%;
        height: 160px;
        object-fit: cover;
        border-radius: 8px;
        display: block;
    }

    .profile-avatar, .profile-avatar-placeholder {
        width: 72px;
        height: 72px;
        border-radius: 50%;
        object-fit: cover;
        flex-shrink: 0;
        box-shadow: 0 2px 8px rgba(0,0,0,0.25);
        border: 3px solid var(--bg-color);
    }

    .overlap {
        position: absolute;
        left: 12px;
        bottom: -36px;
        z-index: 2;
        background: var(--button-hover-bg);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.5rem;
    }

    .name-row {
        position: absolute;
        left: calc(12px + 72px + 12px);
        bottom: 8px;
        right: 12px;
        display: flex;
        align-items: baseline;
        gap: 8px;
        z-index: 1;
    }

    .profile-username {
        margin: 0;
        font-size: 2em;
        color: #000;
        text-shadow: 0 2px 4px rgba(255,255,255,0.8);
        font-weight: 600;
    }

    .profile-nip05-inline {
        font-size: 0.85rem;
        color: #000;
        font-family: monospace;
        opacity: 0.9;
        text-shadow: 0 2px 4px rgba(255,255,255,0.8);
    }

    .about-card {
        padding: 1rem;
        border-radius: 0;
        margin-top: 3rem;
    }

    .profile-about {
        margin: 0;
        color: var(--text-color);
        font-size: 0.9rem;
        line-height: 1.5;
    }

    .settings-actions {
        margin-top: 2rem;
        padding-top: 1rem;
        border-top: 1px solid var(--border-color);
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }
    
    .theme-toggle-section {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }
    
    .theme-toggle-label {
        font-weight: 500;
        color: var(--text-color);
        font-size: 0.9rem;
    }
    
    .theme-toggle-btn {
        padding: 0.5rem 1rem;
        border: 1px solid var(--border-color);
        border-radius: 6px;
        background-color: var(--button-bg);
        color: var(--text-color);
        cursor: pointer;
        font-size: 0.9rem;
        transition: background-color 0.2s;
        display: flex;
        align-items: center;
        gap: 0.25rem;
    }
    
    .theme-toggle-btn:hover {
        background-color: var(--button-hover-bg);
    }

    .logout-btn {
        padding: 0.75rem 1.5rem;
        border: none;
        border-radius: 6px;
        background-color: var(--warning);
        color: white;
        cursor: pointer;
        font-size: 1rem;
        font-weight: 500;
        transition: background-color 0.2s;
        width: 100%;
    }

    .logout-btn:hover {
        background-color: #e53935;
    }
    
    @media (max-width: 640px) {
        .settings-drawer {
            width: 100%;
        }
        
        .name-row {
            left: calc(8px + 56px + 8px);
            bottom: 6px;
            right: 8px;
            gap: 6px;
        }

    }
</style>