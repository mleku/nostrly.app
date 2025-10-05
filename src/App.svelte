<script>
	export let name;
	
	let sidebarExpanded = true;
	let isDarkTheme = false;
	
	function toggleSidebar() {
		sidebarExpanded = !sidebarExpanded;
	}
	
	function toggleTheme() {
		isDarkTheme = !isDarkTheme;
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
		<img src="/orly.png" alt="Orly Logo" class="logo" />
		<div class="text-area">
			<textarea placeholder="What's on your mind?"></textarea>
		</div>
		<button class="theme-toggle-btn" on:click={toggleTheme}>
			{isDarkTheme ? '☀️' : '🌙'}
		</button>
		<button class="login-btn">Login</button>
	</div>
</header>

<!-- Main Content Area -->
<div class="app-container" class:dark-theme={isDarkTheme}>
	<!-- Sidebar -->
	<aside class="sidebar" class:collapsed={!sidebarExpanded} class:dark-theme={isDarkTheme}>
		<div class="sidebar-content">
			<div class="tabs">
				<div class="tab">
					<span class="tab-icon">👥</span>
					{#if sidebarExpanded}<span class="tab-label">follows</span>{/if}
				</div>
				<div class="tab">
					<span class="tab-icon">🌍</span>
					{#if sidebarExpanded}<span class="tab-label">global</span>{/if}
				</div>
				<div class="tab">
					<span class="tab-icon">✏️</span>
					{#if sidebarExpanded}<span class="tab-label">write</span>{/if}
				</div>
			</div>
			<button class="toggle-btn" on:click={toggleSidebar}>
				{sidebarExpanded ? '◀' : '▶'}
			</button>
		</div>
	</aside>

	<!-- Main Content -->
	<main class="main-content">
		<h1>Hello {name}!</h1>
	</main>
</div>

<style>
	:global(body) {
		margin: 0;
		padding: 0;
		--bg-color: #ffffff;
		--header-bg: #f8f9fa;
		--border-color: #dee2e6;
		--text-color: #333333;
		--sidebar-bg: #f8f9fa;
		--tab-hover-bg: #e9ecef;
		--input-border: #ccc;
		--button-bg: #f8f9fa;
		--button-hover-bg: #e9ecef;
	}

	:global(body.dark-theme) {
		--bg-color: #1a1a1a;
		--header-bg: #2d2d2d;
		--border-color: #404040;
		--text-color: #ffffff;
		--sidebar-bg: #2d2d2d;
		--tab-hover-bg: #404040;
		--input-border: #555;
		--button-bg: #2d2d2d;
		--button-hover-bg: #404040;
	}

	/* Header Styles */
	.main-header {
		height: 2.5em;
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
		padding: 0 1rem 0 0;
		gap: 1rem;
	}

	.logo {
		height: 2.5em;
		width: 2.5em;
		object-fit: contain;
		flex-shrink: 0;
	}

	.text-area {
		flex: 1;
		height: 100%;
		display: flex;
		align-items: center;
	}

	.text-area textarea {
		width: 100%;
		height: 1.8em;
		resize: none;
		padding: 0.3em;
		font-family: inherit;
		font-size: 0.9em;
		background-color: var(--bg-color);
		color: var(--text-color);
	}

	.theme-toggle-btn {
		padding: 0.4em 0.6em;
		background-color: var(--button-bg);
		cursor: pointer;
		flex-shrink: 0;
		font-size: 1.2em;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-color);
	}

	.theme-toggle-btn:hover {
		background-color: var(--button-hover-bg);
	}

	.login-btn {
		padding: 0.4em 1em;
		background-color: #007bff;
		color: white;
		cursor: pointer;
		flex-shrink: 0;
	}

	.login-btn:hover {
		background-color: #0056b3;
	}

	/* App Container */
	.app-container {
		display: flex;
		margin-top: 2.5em;
		height: calc(100vh - 2.5em);
	}

	/* Sidebar Styles */
	.sidebar {
		width: 200px;
		background-color: var(--sidebar-bg);
		transition: width 0.3s ease;
		overflow: hidden;
		color: var(--text-color);
	}

	.sidebar.collapsed {
		width: 60px;
	}

	.sidebar-content {
		height: 100%;
		display: flex;
		flex-direction: column;
		padding: 1rem 0;
	}

	.tabs {
		flex: 1;
	}

	.tab {
		height: 2.5em;
		display: flex;
		align-items: center;
		padding: 0 1rem;
		cursor: pointer;
		transition: background-color 0.2s ease;
		margin-bottom: 0.5em;
		gap: 0.75rem;
	}

	.tab:hover {
		background-color: var(--tab-hover-bg);
	}

	.tab-icon {
		font-size: 1.2em;
		flex-shrink: 0;
		width: 1.5em;
		text-align: center;
	}

	.tab-label {
		font-size: 0.9em;
		font-weight: 500;
		white-space: nowrap;
	}

	.toggle-btn {
		height: 2.5em;
		margin: 0 1rem;
		background-color: var(--bg-color);
		cursor: pointer;
		font-size: 1em;
		transition: background-color 0.2s ease;
		color: var(--text-color);
	}

	.toggle-btn:hover {
		background-color: var(--button-hover-bg);
	}

	/* Main Content */
	.main-content {
		flex: 1;
		padding: 2rem;
		overflow-y: auto;
	}

	.main-content h1 {
		color: #ff3e00;
		text-transform: uppercase;
		font-size: 4em;
		font-weight: 100;
		text-align: center;
	}

	@media (max-width: 640px) {
		.header-content {
			padding: 0 0.5rem;
			gap: 0.5rem;
		}
		
		.text-area textarea {
			font-size: 0.8em;
		}
		
		.sidebar {
			width: 150px;
		}
		
		.sidebar.collapsed {
			width: 50px;
		}
		
		.main-content {
			padding: 1rem;
		}
		
		.main-content h1 {
			font-size: 2.5em;
		}
	}
</style>