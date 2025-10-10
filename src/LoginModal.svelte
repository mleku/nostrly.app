<script>
    import { createEventDispatcher } from 'svelte';
    import { loginWithExtension } from './nostr.js';
    
    const dispatch = createEventDispatcher();
    
    export let showModal = false;
    export let isDarkTheme = false;
    
    let isLoading = false;
    let errorMessage = '';
    let successMessage = '';
    
    function closeModal() {
        showModal = false;
        errorMessage = '';
        successMessage = '';
        dispatch('close');
    }
    
    async function loginWithExtensionHandler() {
        isLoading = true;
        errorMessage = '';
        successMessage = '';
        
        try {
            // Use NDK extension login
            const result = await loginWithExtension();
            
            if (result.pubkey) {
                // Store authentication info
                localStorage.setItem('nostr_auth_method', 'extension');
                localStorage.setItem('nostr_pubkey', result.pubkey);
                
                successMessage = 'Successfully logged in with extension!';
                dispatch('login', {
                    method: 'extension',
                    pubkey: result.pubkey,
                    privateKey: null,
                    signer: result.signer,
                    profile: result.profile
                });
                
                setTimeout(() => {
                    closeModal();
                }, 1000);
            }
        } catch (error) {
            errorMessage = error.message;
        } finally {
            isLoading = false;
        }
    }
</script>

{#if showModal}
    <div class="modal-overlay" on:click={closeModal} on:keydown={(e) => e.key === 'Escape' && closeModal()} role="button" tabindex="0">
        <div class="modal" class:dark-theme={isDarkTheme} on:click|stopPropagation on:keydown|stopPropagation>
            <div class="modal-header">
                <h2>Login to Nostr</h2>
                <button class="close-btn" on:click={closeModal}>✕</button>
            </div>
            <div class="modal-content">
                <div class="login-section">
                    <p>Login using a NIP-07 compatible browser extension like nos2x or Alby.</p>
                    
                    {#if errorMessage}
                        <div class="error-message">
                            {errorMessage}
                        </div>
                    {/if}
                    
                    {#if successMessage}
                        <div class="success-message">
                            {successMessage}
                        </div>
                    {/if}
                    
                    <button 
                        class="login-extension-btn"
                        on:click={loginWithExtensionHandler}
                        disabled={isLoading}
                    >
                        {isLoading ? 'Connecting...' : 'Log in using extension'}
                    </button>
                </div>
            </div>
        </div>
    </div>
{/if}

<style>
    .modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        z-index: 1000;
        display: flex;
        justify-content: center;
        align-items: center;
    }
    
    .modal {
        background: var(--bg-color);
        border-radius: 8px;
        padding: 0;
        max-width: 500px;
        width: 90%;
        max-height: 80vh;
        overflow-y: auto;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    }
    
    .modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 1rem;
        border-bottom: 1px solid var(--border-color);
        background: var(--header-bg);
    }
    
    .modal-header h2 {
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
    
    .modal-content {
        padding: 1.5rem;
    }
    
    .login-section {
        text-align: center;
    }
    
    .login-section p {
        margin: 0 0 1.5rem 0;
        color: var(--text-color);
        font-size: 1rem;
        line-height: 1.5;
    }
    
    .login-extension-btn {
        background: #4CAF50;
        color: white;
        border: none;
        border-radius: 6px;
        padding: 0.75rem 1.5rem;
        font-size: 1rem;
        font-weight: 500;
        cursor: pointer;
        transition: background-color 0.2s;
        min-width: 200px;
    }
    
    .login-extension-btn:hover:not(:disabled) {
        background: #45a049;
    }
    
    .login-extension-btn:disabled {
        background: #ccc;
        cursor: not-allowed;
    }
    
    .error-message {
        background: #ffebee;
        color: #c62828;
        padding: 0.75rem;
        border-radius: 4px;
        margin-bottom: 1rem;
        border: 1px solid #ffcdd2;
        font-size: 0.9rem;
    }
    
    .success-message {
        background: #e8f5e8;
        color: #2e7d32;
        padding: 0.75rem;
        border-radius: 4px;
        margin-bottom: 1rem;
        border: 1px solid #c8e6c9;
        font-size: 0.9rem;
    }
    
    :global(body.dark-theme) .error-message {
        background: #3d1a1a;
        color: #ff6b6b;
        border-color: #5d2a2a;
    }
    
    :global(body.dark-theme) .success-message {
        background: #1a3d1a;
        color: #6bff6b;
        border-color: #2a5d2a;
    }
    
    @media (max-width: 640px) {
        .modal {
            width: 95%;
            margin: 1rem;
        }
        
        .modal-content {
            padding: 1rem;
        }
        
        .login-extension-btn {
            min-width: 150px;
            padding: 0.6rem 1.2rem;
            font-size: 0.9rem;
        }
    }
</style>
