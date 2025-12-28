/**
 * Scroll Distortion Effect (No-Loop Variant)
 * Identical to scroll-distortion.js but WITHOUT infinite looping.
 * Next/previous transitions stop at the first/last image.
 */

class ScrollDistortionEffect {
    constructor(options) {
        this.config = {
            parent: options.parent,
            images: options.images || [],
            displacementImages: options.displacementImages || options.displacementImage ? [options.displacementImage] : [],
            intensity: options.intensity || 0.4,
            transitionSpeed: options.transitionSpeed || 1.2,
            easing: options.easing || 'easeInOut',
            onImageChange: options.onImageChange || null
        };

        this.currentIndex = 0;
        this.isTransitioning = false;
        this.progress = 0;
        this.targetProgress = 0;
        
        // Store displacement textures array
        this.displacementTextures = [];

        // Initialize Three.js scene
        this.initScene();
        this.loadTextures();
        this.animate();
    }

    initScene() {
        const parent = this.config.parent;
        const width = parent.offsetWidth;
        const height = parent.offsetHeight;

        // Create scene
        this.scene = new THREE.Scene();

        // Create camera
        this.camera = new THREE.OrthographicCamera(
            width / -2,
            width / 2,
            height / 2,
            height / -2,
            1,
            1000
        );
        this.camera.position.z = 1;

        // Create renderer
        this.renderer = new THREE.WebGLRenderer({ 
            antialias: false,
            alpha: false 
        });
        this.renderer.setClearColor(0x000000, 1);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(width, height);
        
        parent.appendChild(this.renderer.domElement);

        // Handle window resize
        this.handleResize = this.handleResize.bind(this);
        window.addEventListener('resize', this.handleResize);
    }

    loadTextures() {
        const loader = new THREE.TextureLoader();
        loader.crossOrigin = 'anonymous';
        
        // Load all image textures
        this.textures = [];
        this.textureResolutions = [];
        let loadedImageCount = 0;
        let loadedDisplacementCount = 0;
        
        // Count valid displacement maps (for initialization check)
        const validDisplacementCount = this.config.displacementImages.filter(
            url => url && typeof url === 'string' && url.trim() !== ''
        ).length;

        this.config.images.forEach((imageSrc, index) => {
            loader.load(
                imageSrc, 
                (texture) => {
                    texture.minFilter = THREE.LinearFilter;
                    texture.magFilter = THREE.LinearFilter;
                    texture.wrapS = THREE.ClampToEdgeWrapping;
                    texture.wrapT = THREE.ClampToEdgeWrapping;
                    this.textures[index] = texture;
                    if (texture.image) {
                        this.textureResolutions[index] = new THREE.Vector2(texture.image.width, texture.image.height);
                    }
                    loadedImageCount++;

                    if (loadedImageCount >= 2 && loadedDisplacementCount >= validDisplacementCount && validDisplacementCount > 0) {
                        this.onTexturesLoaded();
                    }
                },
                undefined,
                (error) => {
                    console.error(`Failed to load image ${index}:`, imageSrc, error);
                }
            );
        });

        // Load all displacement textures (preserving original indices)
        if (this.config.displacementImages.length > 0) {
            this.config.displacementImages.forEach((displacementSrc, index) => {
                // Skip if displacement URL is invalid
                if (!displacementSrc || typeof displacementSrc !== 'string' || displacementSrc.trim() === '') {
                    console.warn(`Skipping invalid displacement map ${index}:`, displacementSrc);
                    return;
                }

                loader.load(
                    displacementSrc, 
                    (texture) => {
                        texture.wrapS = THREE.ClampToEdgeWrapping;
                        texture.wrapT = THREE.ClampToEdgeWrapping;
                        this.displacementTextures[index] = texture;
                        loadedDisplacementCount++;

                        // Use first displacement as default
                        if (index === 0) {
                            this.displacementTexture = texture;
                        }

                        if (loadedImageCount >= 2 && loadedDisplacementCount >= validDisplacementCount && validDisplacementCount > 0) {
                            this.onTexturesLoaded();
                        }
                    },
                    undefined,
                    (error) => {
                        console.error(`Failed to load displacement map ${index}:`, displacementSrc, error);
                    }
                );
            });
        }
    }

    onTexturesLoaded() {
        // Wait for at least first 2 image textures and at least one displacement to load
        if (!this.textures[0] || !this.textures[1] || !this.displacementTexture || this.material) {
            return;
        }

        this.createMaterial();
        this.createMesh();
        
        // If there's a pending initial image index, apply it now
        if (this.pendingInitialIndex !== undefined) {
            this.applyInitialImage(this.pendingInitialIndex);
            this.pendingInitialIndex = undefined;
        }
    }

    // Get displacement texture index based on target state
    // States 1-3 (indices 0-2): displacement 0
    // States 4-7 (indices 3-6): displacement 1
    // States 8-11 (indices 7-10): displacement 2
    getDisplacementIndex(targetIndex) {
        if (targetIndex >= 0 && targetIndex <= 2) {
            return 0; // First displacement for states 1-3
        } else if (targetIndex >= 3 && targetIndex <= 6) {
            return 1; // Second displacement for states 4-7
        } else if (targetIndex >= 7 && targetIndex <= 10) {
            return 2; // Third displacement for states 8-11
        }
        // Fallback to first displacement
        return 0;
    }

    createMaterial() {
        // Custom shader for distortion effect
        const vertexShader = `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `;

        const fragmentShader = `
            varying vec2 vUv;
            uniform sampler2D texture1;
            uniform sampler2D texture2;
            uniform sampler2D displacement;
            uniform float progress;
            uniform float intensity;
            uniform vec2 resolution;
            uniform vec2 texRes1;
            uniform vec2 texRes2;

            void main() {
                vec2 uv = vUv;
                
                // Get displacement value
                vec4 disp = texture2D(displacement, uv);
                
                // Calculate distortion amount based on progress
                float distortionAmount = intensity * (1.0 - abs(progress - 0.5) * 2.0);
                
                // Apply distortion to UV coordinates
                vec2 distortedUV1 = vec2(
                    uv.x + (disp.r - 0.5) * distortionAmount * progress,
                    uv.y + (disp.g - 0.5) * distortionAmount * progress
                );
                vec2 distortedUV2 = vec2(
                    uv.x - (disp.r - 0.5) * distortionAmount * (1.0 - progress),
                    uv.y - (disp.g - 0.5) * distortionAmount * (1.0 - progress)
                );
                
                // Clamp distorted UV coordinates to prevent edge artifacts
                distortedUV1 = clamp(distortedUV1, 0.0, 1.0);
                distortedUV2 = clamp(distortedUV2, 0.0, 1.0);

                // background-size: cover for texture1
                float containerAspect = resolution.x / resolution.y;
                float texAspect1 = texRes1.x / texRes1.y;
                vec2 uv1 = distortedUV1 - 0.5;
                if (containerAspect > texAspect1) {
                    float scale = containerAspect / texAspect1;
                    uv1.x *= scale;
                } else {
                    float scale = texAspect1 / containerAspect;
                    uv1.y *= scale;
                }
                uv1 += 0.5;
                // Clamp cover-calculated UVs to prevent edge artifacts
                uv1 = clamp(uv1, 0.0, 1.0);

                // background-size: cover for texture2
                float texAspect2 = texRes2.x / texRes2.y;
                vec2 uv2 = distortedUV2 - 0.5;
                if (containerAspect > texAspect2) {
                    float scale2 = containerAspect / texAspect2;
                    uv2.x *= scale2;
                } else {
                    float scale2 = texAspect2 / containerAspect;
                    uv2.y *= scale2;
                }
                uv2 += 0.5;
                // Clamp cover-calculated UVs to prevent edge artifacts
                uv2 = clamp(uv2, 0.0, 1.0);
                
                // Sample both textures
                vec4 color1 = texture2D(texture1, uv1);
                vec4 color2 = texture2D(texture2, uv2);
                
                // Mix based on progress
                vec4 finalColor = mix(color1, color2, progress);
                
                gl_FragColor = finalColor;
            }
        `;

        this.material = new THREE.ShaderMaterial({
            uniforms: {
                texture1: { value: this.textures[0] },
                texture2: { value: this.textures[1] },
                displacement: { value: this.displacementTexture },
                progress: { value: 0 },
                intensity: { value: this.config.intensity },
                resolution: { value: new THREE.Vector2(
                    this.config.parent.offsetWidth,
                    this.config.parent.offsetHeight
                )},
                texRes1: { value: this.textureResolutions[0] || new THREE.Vector2(1920, 1080) },
                texRes2: { value: this.textureResolutions[1] || new THREE.Vector2(1920, 1080) }
            },
            vertexShader,
            fragmentShader
        });
    }

    createMesh() {
        const width = this.config.parent.offsetWidth;
        const height = this.config.parent.offsetHeight;
        const overscan = this.computeOverscanFactor();

        const geometry = new THREE.PlaneGeometry(width * overscan, height * overscan, 1, 1);
        this.mesh = new THREE.Mesh(geometry, this.material);
        this.scene.add(this.mesh);
    }

    // Compute a geometry overscan factor so edges remain offscreen even during distortion
    computeOverscanFactor() {
        const base = 1.05; // small baseline to cover rounding
        const extra = Math.min(0.6, this.config.intensity * 1.2); // grow with intensity, cap
        return base + extra; // e.g. intensity 0.4 -> ~1.53x
    }

    // Easing functions
    easeInOut(t) {
        return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    }

    easeOut(t) {
        return 1 - Math.pow(1 - t, 3);
    }

    // Transition to next image (no wrap)
    transitionToNext() {
        if (this.isTransitioning || !this.material) {
            return;
        }
        const atLast = this.currentIndex >= this.config.images.length - 1;
        if (atLast) {
            return;
        }
        const nextIndex = this.currentIndex + 1;
        this.transitionTo(nextIndex);
    }

    // Transition to previous image (no wrap)
    transitionToPrevious() {
        if (this.isTransitioning || !this.material) {
            return;
        }
        const atFirst = this.currentIndex <= 0;
        if (atFirst) {
            return;
        }
        const prevIndex = this.currentIndex - 1;
        this.transitionTo(prevIndex);
    }

    // Transition to specific index
    transitionTo(targetIndex) {
        if (this.isTransitioning || targetIndex === this.currentIndex || !this.material) {
            return;
        }
        
        if (!this.textures[targetIndex]) {
            console.error('Target texture not loaded:', targetIndex);
            return;
        }

        this.isTransitioning = true;
        this.startTime = Date.now();
        this.targetIndex = targetIndex;

        // Select displacement texture based on target index
        const displacementIndex = this.getDisplacementIndex(targetIndex);
        if (this.displacementTextures[displacementIndex]) {
            this.displacementTexture = this.displacementTextures[displacementIndex];
            this.material.uniforms.displacement.value = this.displacementTexture;
        }

        // Update textures
        this.material.uniforms.texture1.value = this.textures[this.currentIndex];
        this.material.uniforms.texture2.value = this.textures[targetIndex];
        this.material.uniforms.texRes1.value = this.textureResolutions[this.currentIndex] || this.material.uniforms.texRes1.value;
        this.material.uniforms.texRes2.value = this.textureResolutions[targetIndex] || this.material.uniforms.texRes2.value;

        // Call callback if provided
        if (this.config.onImageChange) {
            this.config.onImageChange(targetIndex);
        }

        // Animate progress
        this.animateProgress();
    }

    animateProgress() {
        const elapsed = (Date.now() - this.startTime) / 1000;
        const duration = this.config.transitionSpeed;
        let t = Math.min(elapsed / duration, 1);

        // Apply easing
        t = this.easeOut(t);

        // Update progress
        this.material.uniforms.progress.value = t;

        if (t < 1) {
            requestAnimationFrame(() => this.animateProgress());
        } else {
            // Transition complete
            this.currentIndex = this.targetIndex;
            this.isTransitioning = false;
            
            // Reset progress and update textures for next transition
            this.material.uniforms.progress.value = 0;
            const nextIndex = Math.min(this.currentIndex + 1, this.config.images.length - 1);
            this.material.uniforms.texture1.value = this.textures[this.currentIndex];
            this.material.uniforms.texture2.value = this.textures[nextIndex];
            this.material.uniforms.texRes1.value = this.textureResolutions[this.currentIndex] || this.material.uniforms.texRes1.value;
            this.material.uniforms.texRes2.value = this.textureResolutions[nextIndex] || this.material.uniforms.texRes2.value;
        }
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }

    handleResize() {
        const width = this.config.parent.offsetWidth;
        const height = this.config.parent.offsetHeight;

        // Update camera
        this.camera.left = width / -2;
        this.camera.right = width / 2;
        this.camera.top = height / 2;
        this.camera.bottom = height / -2;
        this.camera.updateProjectionMatrix();

        // Update renderer
        this.renderer.setSize(width, height);

        // Update material uniforms
        if (this.material) {
            this.material.uniforms.resolution.value.set(width, height);
        }

        // Update mesh geometry (respect overscan)
        if (this.mesh) {
            this.mesh.geometry.dispose();
            const overscan = this.computeOverscanFactor();
            this.mesh.geometry = new THREE.PlaneGeometry(width * overscan, height * overscan, 1, 1);
        }
    }

    // Update intensity
    setIntensity(value) {
        this.config.intensity = value;
        if (this.material) {
            this.material.uniforms.intensity.value = value;
        }
        // Rebuild geometry to adjust overscan for new intensity
        if (this.mesh) {
            const width = this.config.parent.offsetWidth;
            const height = this.config.parent.offsetHeight;
            this.mesh.geometry.dispose();
            const overscan = this.computeOverscanFactor();
            this.mesh.geometry = new THREE.PlaneGeometry(width * overscan, height * overscan, 1, 1);
        }
    }

    // Update transition speed
    setTransitionSpeed(value) {
        this.config.transitionSpeed = value;
    }

    // Update displacement maps dynamically (accepts array of URLs)
    setDisplacementImages(urls) {
        if (!Array.isArray(urls) || urls.length === 0) {
            console.error('setDisplacementImages: Invalid urls array');
            return;
        }

        const loader = new THREE.TextureLoader();
        loader.crossOrigin = 'anonymous';
        const self = this;
        let loadedCount = 0;
        const total = urls.length;

        // Dispose old displacement textures
        if (this.displacementTextures && this.displacementTextures.length > 0) {
            this.displacementTextures.forEach(texture => {
                if (texture) texture.dispose();
            });
        }

        this.displacementTextures = [];
        this.config.displacementImages = urls;

        urls.forEach((url, index) => {
            // Skip if displacement URL is invalid
            if (!url || typeof url !== 'string' || url.trim() === '') {
                console.warn(`Skipping invalid displacement map ${index} in setDisplacementImages:`, url);
                return;
            }

            loader.load(
                url,
                function(texture) {
                    texture.wrapS = THREE.ClampToEdgeWrapping;
                    texture.wrapT = THREE.ClampToEdgeWrapping;
                    self.displacementTextures[index] = texture;
                    
                    // Use first as default
                    if (index === 0) {
                        self.displacementTexture = texture;
                        if (self.material) {
                            self.material.uniforms.displacement.value = texture;
                        }
                    }
                },
                undefined,
                function(error) {
                    console.error(`Failed to load displacement map ${index}:`, url, error);
                }
            );
        });
    }

    // Get current index
    getCurrentIndex() {
        return this.currentIndex;
    }

    // Check if transitioning
    isInTransition() {
        return this.isTransitioning;
    }

    // Load images from array of URLs (for 13 images setup)
    setImages(imageUrls) {
        if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
            console.error('setImages: Invalid imageUrls array');
            return;
        }

        const loader = new THREE.TextureLoader();
        loader.crossOrigin = 'anonymous';
        
        // Dispose old textures if they exist
        if (this.textures && this.textures.length > 0) {
            this.textures.forEach(texture => {
                if (texture) texture.dispose();
            });
        }

        // Initialize new arrays
        this.textures = [];
        this.textureResolutions = [];
        this.config.images = imageUrls;
        let loadedImageCount = 0;
        const self = this;
        const totalImages = imageUrls.length;

        imageUrls.forEach((imageSrc, index) => {
            loader.load(
                imageSrc,
                (texture) => {
                    texture.minFilter = THREE.LinearFilter;
                    texture.magFilter = THREE.LinearFilter;
                    texture.wrapS = THREE.ClampToEdgeWrapping;
                    texture.wrapT = THREE.ClampToEdgeWrapping;
                    self.textures[index] = texture;
                    if (texture.image) {
                        self.textureResolutions[index] = new THREE.Vector2(texture.image.width, texture.image.height);
                    }
                    loadedImageCount++;

                    // If we have at least 2 images and at least one displacement loaded, we can initialize
                    if (loadedImageCount >= 2 && self.displacementTexture) {
                        // Update material textures if it exists
                        if (self.material) {
                            // Check if there's a pending initial image index
                            if (self.pendingInitialIndex !== undefined) {
                                self.applyInitialImage(self.pendingInitialIndex);
                                self.pendingInitialIndex = undefined;
                            } else {
                                self.material.uniforms.texture1.value = self.textures[0];
                                self.material.uniforms.texture2.value = self.textures[Math.min(1, totalImages - 1)];
                                self.material.uniforms.texRes1.value = self.textureResolutions[0] || new THREE.Vector2(1920, 1080);
                                self.material.uniforms.texRes2.value = self.textureResolutions[Math.min(1, totalImages - 1)] || new THREE.Vector2(1920, 1080);
                            }
                        } else {
                            self.onTexturesLoaded();
                        }
                    }
                },
                undefined,
                (error) => {
                    console.error(`Failed to load image ${index}:`, imageSrc, error);
                }
            );
        });
    }

    // Set initial image index without transition (for initialization)
    setInitialImage(index) {
        const safeIndex = Math.max(0, Math.min(index, this.config.images.length - 1));
        this.currentIndex = safeIndex;

        // If material and textures are ready, set them immediately
        if (this.material && this.textures && this.textures.length > 0 && this.textures[safeIndex]) {
            this.applyInitialImage(safeIndex);
            return;
        }

        // Otherwise, wait for textures to load
        // This will be handled when textures finish loading
        if (!this.pendingInitialIndex) {
            this.pendingInitialIndex = safeIndex;
        }
    }

    // Internal method to apply initial image (called when textures are ready)
    applyInitialImage(index) {
        if (!this.material || !this.textures || !this.textures[index]) {
            return;
        }

        const safeIndex = Math.max(0, Math.min(index, this.config.images.length - 1));
        
        // Set displacement texture based on initial index
        const displacementIndex = this.getDisplacementIndex(safeIndex);
        if (this.displacementTextures[displacementIndex]) {
            this.displacementTexture = this.displacementTextures[displacementIndex];
            this.material.uniforms.displacement.value = this.displacementTexture;
        }
        
        // Set textures without transition
        this.material.uniforms.texture1.value = this.textures[safeIndex];
        const nextIndex = Math.min(safeIndex + 1, this.config.images.length - 1);
        if (this.textures[nextIndex]) {
            this.material.uniforms.texture2.value = this.textures[nextIndex];
            this.material.uniforms.texRes2.value = this.textureResolutions[nextIndex] || new THREE.Vector2(1920, 1080);
        }
        this.material.uniforms.texRes1.value = this.textureResolutions[safeIndex] || new THREE.Vector2(1920, 1080);
        this.material.uniforms.progress.value = 0;
        this.currentIndex = safeIndex;
    }

    // Destroy and cleanup
    destroy() {
        window.removeEventListener('resize', this.handleResize);
        
        if (this.mesh) {
            this.mesh.geometry.dispose();
            this.material.dispose();
            this.scene.remove(this.mesh);
        }
        
        this.textures.forEach(texture => texture.dispose());
        if (this.displacementTextures && this.displacementTextures.length > 0) {
            this.displacementTextures.forEach(texture => {
                if (texture) texture.dispose();
            });
        }
        
        this.renderer.dispose();
        this.config.parent.removeChild(this.renderer.domElement);
    }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ScrollDistortionEffect;
}

// Browser global for Webflow usage
if (typeof window !== 'undefined') {
    window.ScrollDistortionEffect = ScrollDistortionEffect;
}


