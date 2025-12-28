/**
 * Webflow Controller for Scroll Distortion Effect
 * Bridges Webflow interactions with the WebGL transition engine
 */

class WebflowGLController {
    constructor(config) {
        this.config = {
            containerId: config.containerId || 'gl-container',
            controllerId: config.controllerId || 'gl-controller',
            imageUrls: config.imageUrls || [], // Array of 11 image URLs
            displacementImageUrls: Array.isArray(config.displacementImageUrls) 
                ? config.displacementImageUrls.filter(url => url && typeof url === 'string' && url.trim() !== '')
                : [], // Array of 3 displacement image URLs (filtered to remove invalid entries)
            intensity: config.intensity || 0.4,
            transitionSpeed: config.transitionSpeed || 1.2,
            scrollLockDuration: config.scrollLockDuration || 1200,
            contentSectionSelector: config.contentSectionSelector || null, // Optional: CSS selector for content sections (e.g., '.content-section')
            contentSectionPrefix: config.contentSectionPrefix || 'section-' // Prefix for section IDs/classes (e.g., 'section-1', 'section-2')
        };

        this.engine = null;
        this.observer = null;
        this.scrollLocked = false;
        this.scrollUnlockTimer = null;
        this.currentState = null;
        this.isInitializing = true; // Flag to prevent observer from firing during initialization

        // Initialize
        this.init();
    }

    init() {
        // Set history scroll restoration to manual
        if ('scrollRestoration' in history) {
            history.scrollRestoration = 'manual';
        }

        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.setup());
        } else {
            this.setup();
        }
    }

    setup() {
        const container = document.getElementById(this.config.containerId);
        if (!container) {
            console.error(`Container element #${this.config.containerId} not found`);
            return;
        }

        const controller = document.getElementById(this.config.controllerId);
        if (!controller) {
            console.error(`Controller element #${this.config.controllerId} not found`);
            return;
        }

        // Read initial state FIRST (before initializing engine)
        // This ensures we know which state to show before engine setup
        this.readInitialState(controller);

        // Set initial content section visibility
        this.updateContentSections(this.currentState || 0);

        // Initialize WebGL engine (will use the initial state we just read)
        this.initEngine(container);

        // Setup MutationObserver to watch for class changes
        this.setupObserver(controller);

        // Mark initialization as complete after a short delay
        // This allows the initial state to settle before observer becomes active
        setTimeout(() => {
            this.isInitializing = false;
        }, 500);
    }

    initEngine(container) {
        // Store initial state index before any async operations
        const initialStateIndex = this.currentState !== null ? this.currentState : 0;
        
        // Create engine instance (it will need at least 2 images initially)
        // We'll update it with all 11 images after initialization
        const initialImages = this.config.imageUrls.length >= 2 
            ? [this.config.imageUrls[0], this.config.imageUrls[1]]
            : this.config.imageUrls;

        // Use first displacement as initial (or empty array if not provided)
        const initialDisplacement = this.config.displacementImageUrls.length > 0
            ? [this.config.displacementImageUrls[0]]
            : [];

        this.engine = new ScrollDistortionEffect({
            parent: container,
            images: initialImages,
            displacementImages: initialDisplacement,
            intensity: this.config.intensity,
            transitionSpeed: this.config.transitionSpeed
        });

        // Load all 11 images and all 3 displacement maps if provided
        if (this.config.imageUrls.length > 2 || this.config.displacementImageUrls.length > 1) {
            // Wait a bit for initial setup, then load all images
            setTimeout(() => {
                if (this.config.displacementImageUrls.length === 3) {
                    this.engine.setDisplacementImages(this.config.displacementImageUrls);
                }
                
                if (this.config.imageUrls.length > 2) {
                    // Load all images and set initial image when complete
                    this.engine.setImages(this.config.imageUrls, () => {
                        // All images loaded, now set the initial image if needed
                        if (initialStateIndex !== 0 && this.engine) {
                            this.engine.setInitialImage(initialStateIndex);
                        }
                    });
                } else if (initialStateIndex !== 0) {
                    // If we don't need to load more images, set initial image now
                    setTimeout(() => {
                        if (this.engine) {
                            this.engine.setInitialImage(initialStateIndex);
                        }
                    }, 200);
                }
            }, 100);
        } else {
            // If we have 2 or fewer images, set initial image immediately if needed
            if (initialStateIndex !== 0) {
                setTimeout(() => {
                    if (this.engine) {
                        this.engine.setInitialImage(initialStateIndex);
                    }
                }, 200);
            }
        }
    }

    setupObserver(controller) {
        // Create MutationObserver to watch for class changes
        this.observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    this.handleClassChange(controller);
                }
            });
        });

        // Start observing
        this.observer.observe(controller, {
            attributes: true,
            attributeFilter: ['class']
        });
    }

    handleClassChange(controller) {
        // Ignore changes during initialization to prevent chaos on reload
        if (this.isInitializing) {
            return;
        }

        const stateNumber = this.extractStateNumber(controller);
        
        if (stateNumber !== null && stateNumber !== this.currentState) {
            this.currentState = stateNumber;
            this.triggerTransition(stateNumber);
        }
    }

    extractStateNumber(element) {
        // Extract number from class like "state-1", "state-2", etc.
        // If multiple state classes exist, use the highest number (most recent)
        const classList = Array.from(element.classList);
        let maxState = null;
        let maxNum = -1;
        
        for (const className of classList) {
            const match = className.match(/^state-(\d+)$/);
            if (match) {
                const num = parseInt(match[1], 10);
                if (num > maxNum) {
                    maxNum = num;
                    maxState = num;
                }
            }
        }
        
        if (maxState !== null) {
            // Convert to 0-based index (state-1 -> 0, state-2 -> 1, etc.)
            return Math.max(0, maxState - 1);
        }
        return null;
    }

    triggerTransition(index) {
        if (!this.engine) {
            console.warn('Engine not initialized, cannot trigger transition');
            return;
        }

        // Update content sections if configured
        this.updateContentSections(index);

        // Lock scroll
        this.lockScroll();

        // Trigger transition (convert to 0-based index if needed)
        const targetIndex = Math.max(0, Math.min(index, this.config.imageUrls.length - 1));
        this.engine.transitionTo(targetIndex);

        // Auto-unlock after duration (safety mechanism)
        this.scheduleScrollUnlock();
    }

    // Update content sections visibility based on state (1-based state number)
    updateContentSections(stateIndex) {
        if (!this.config.contentSectionSelector) {
            return; // Not configured, skip
        }

        const stateNumber = stateIndex + 1; // Convert to 1-based (state 1, 2, etc.)
        const sections = document.querySelectorAll(this.config.contentSectionSelector);
        
        sections.forEach((section, index) => {
            const sectionNumber = index + 1;
            if (sectionNumber === stateNumber) {
                section.style.display = 'block';
            } else {
                section.style.display = 'none';
            }
        });
    }

    lockScroll() {
        if (this.scrollLocked) {
            return; // Already locked
        }

        this.scrollLocked = true;

        // Prevent scroll on wheel events
        const preventScroll = (e) => {
            if (this.scrollLocked) {
                e.preventDefault();
                e.stopPropagation();
            }
        };

        // Prevent scroll on touch events
        const preventTouchScroll = (e) => {
            if (this.scrollLocked) {
                e.preventDefault();
                e.stopPropagation();
            }
        };

        // Prevent scroll on keyboard
        const preventKeyScroll = (e) => {
            if (this.scrollLocked) {
                const scrollKeys = [32, 33, 34, 35, 36, 37, 38, 39, 40]; // Space, Page Up/Down, Home, End, Arrow keys
                if (scrollKeys.includes(e.keyCode)) {
                    e.preventDefault();
                    e.stopPropagation();
                }
            }
        };

        // Add event listeners with passive: false to allow preventDefault
        window.addEventListener('wheel', preventScroll, { passive: false, capture: true });
        window.addEventListener('touchmove', preventTouchScroll, { passive: false, capture: true });
        window.addEventListener('keydown', preventKeyScroll, { passive: false, capture: true });

        // Store cleanup function
        this.scrollUnlockCleanup = () => {
            window.removeEventListener('wheel', preventScroll, { passive: false, capture: true });
            window.removeEventListener('touchmove', preventTouchScroll, { passive: false, capture: true });
            window.removeEventListener('keydown', preventKeyScroll, { passive: false, capture: true });
            this.scrollLocked = false;
        };
    }

    unlockScroll() {
        if (!this.scrollLocked) {
            return; // Already unlocked
        }

        if (this.scrollUnlockCleanup) {
            this.scrollUnlockCleanup();
            this.scrollUnlockCleanup = null;
        }

        // Clear any pending unlock timer
        if (this.scrollUnlockTimer) {
            clearTimeout(this.scrollUnlockTimer);
            this.scrollUnlockTimer = null;
        }
    }

    scheduleScrollUnlock() {
        // Clear any existing timer
        if (this.scrollUnlockTimer) {
            clearTimeout(this.scrollUnlockTimer);
        }

        // Schedule unlock after duration
        this.scrollUnlockTimer = setTimeout(() => {
            this.unlockScroll();
        }, this.config.scrollLockDuration);
    }

    readInitialState(controller) {
        const stateNumber = this.extractStateNumber(controller);
        
        // Store the initial state number (will be used in initEngine)
        if (stateNumber !== null) {
            this.currentState = stateNumber;
        } else {
            // Default to state 0 (first image) if no state class found
            this.currentState = 0;
        }
    }

    // Cleanup method
    destroy() {
        // Stop observing
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }

        // Unlock scroll
        this.unlockScroll();

        // Destroy engine
        if (this.engine) {
            this.engine.destroy();
            this.engine = null;
        }
    }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WebflowGLController;
}

// Browser global for Webflow usage
if (typeof window !== 'undefined') {
    window.WebflowGLController = WebflowGLController;
}

