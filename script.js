    // --- Configuration & Constants ---
    const CONFIG = {
        API_BASE_URL: 'https://workflows.aphelionxinnovations.com',
        LOGIN_PAGE_URL: 'https://hicham-taoufik.github.io/login/', // Absolute URL
        QR_TARGET_BASE_URL: 'app://medilink/patient', // MUST MATCH RECEPTION
        TOKEN_KEY: 'authToken',
        USER_ID_KEY: 'userIdentifier',
        SESSION_TIMEOUT: 30 * 60 * 1000, // 30 minutes
        MESSAGE_DISPLAY_TIME: 5000,
        TOAST_DISPLAY_TIME: 4000,
        // API Endpoints
        GET_VISIT_DETAILS_ENDPOINT: "/webhook/doctor/get-visit-details",
        GLOBAL_DICTATION_ENDPOINT: "/webhook/process-visit-dictation", // Remains for global dictation
        UPDATE_CONSULTATION_ENDPOINT: "/webhook/doctor/update-consultation",
        SUBMIT_PRESCRIPTION_AI_ENDPOINT: "/webhook/doctor-submit-prescription",
        VALIDATE_PRESCRIPTION_AI_ENDPOINT: "/webhook/doctor-validate-prescription",
        // TRANSCRIBE_FIELD_ENDPOINT: "/webhook/..." // No longer needed as primary endpoint for fields
        // NOTE: Individual field transcription endpoints are now defined in getFieldConfig
    };

    // --- Globals ---
    let currentIPP = null;
    let currentVisitId = null;
    let currentUserIdentifier = localStorage.getItem(CONFIG.USER_ID_KEY) || 'unknown_doctor';
    let sessionTimeoutId = null; // For session timeout

    // Recording Globals
    let mediaRecorder; let audioChunks = []; let recordingField = null; // For individual recordings
    let isGlobalRecording = false; let globalMediaRecorder; let globalAudioChunks = []; // For global recording

    // DOM Cache (example)
    const patientInfoDiv = document.getElementById('patientInfo');
    const nurseDataDisplayDiv = document.getElementById('nurseDataDisplay');
    const consultationForm = document.getElementById('consultationForm');
    const scanButton = document.getElementById('scanQrButton');
    const scannerContainer = document.getElementById('scanner-container');
    const video = document.getElementById('scanner-video');
    const aiSuggestionDiv = document.getElementById('aiSuggestion');
    // Add other frequent DOM elements here if needed


    // --- UTILITY FUNCTIONS ---
    function sanitizeInput(input) { if (input === null || input === undefined) return ""; const temp = document.createElement("div"); temp.textContent = String(input); return temp.innerHTML; }
    function formatDate(dateString, includeTime = false) { if (!dateString || typeof dateString !== 'string') { return '-'; } try { const dateObj = new Date(dateString); if (isNaN(dateObj.getTime())) { return 'Date Invalide'; } const options = { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' }; if (includeTime) { options.hour = '2-digit'; options.minute = '2-digit'; options.timeZone = undefined; /* Use local time for display if time is included */ } let formatted = dateObj.toLocaleDateString('fr-FR', options); /* Correct UTC display formatting */ if (!includeTime && dateString.includes('T')) { /* If it's a full ISO string but time not needed */ formatted = dateObj.toLocaleDateString('fr-CA', { timeZone: 'UTC' }).replace(/-/g, '/'); // Use fr-CA for YYYY/MM/DD then replace - with / for desired format? Or stick to fr-FR DD/MM/YYYY? Let's stick to fr-FR for consistency. formatted = dateObj.toLocaleDateString('fr-FR', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' }); } else if (!includeTime && !dateString.includes('T') && dateString.length <= 10) { /* Handle simple YYYY-MM-DD or similar */ const parts = dateString.split(/[-/]/); if (parts.length === 3) { formatted = `${parts[2]}/${parts[1]}/${parts[0]}`; // Assuming DD/MM/YYYY format is desired } else { formatted = dateObj.toLocaleDateString('fr-FR', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' }); } } return formatted; } catch (e) { console.error("Date format error:", e); return 'Err Format'; } }
    function showMessage(elementId, message, type = 'info') { const el = document.getElementById(elementId); if (!el) { console.error(`Msg Elem "${elementId}" not found.`); return; } const icons = { 'info':'fas fa-info-circle','success':'fas fa-check-circle','warning':'fas fa-exclamation-triangle','error':'fas fa-times-circle','loading':'fas fa-spinner fa-spin' }; const icon = icons[type] || icons['info']; const iconHtml = message ? `<i class="${icon}" style="margin-right: 6px;"></i>` : ''; el.innerHTML = message ? `${iconHtml}${message}` : ""; el.style.display = message ? "block" : "none"; el.className = 'message'; if (type) el.classList.add(`message-${type}`); if ((type === 'success' || type === 'warning') && message && elementId !== 'scanResult' && !elementId.startsWith('saveConsultationMessage')) { setTimeout(() => { if (el.innerHTML.includes(message)) { el.style.display = 'none'; el.innerHTML = '';} }, CONFIG.MESSAGE_DISPLAY_TIME); } }

    // --- AUTH & SESSION ---
    function redirectToLogin() {
        console.log("Redirecting to login page:", CONFIG.LOGIN_PAGE_URL);
        window.location.href = CONFIG.LOGIN_PAGE_URL;
    }
    function fetchWithAuth(url, options = {}) {
        const token = localStorage.getItem(CONFIG.TOKEN_KEY);
        if (!token) {
            console.error('Doctor: No auth token found in localStorage.');
            clearDoctorUI();
            alert('Session expirée ou invalide. Veuillez vous reconnecter.');
            redirectToLogin();
            return Promise.reject(new Error('Token non trouvé.')); // Stop further execution
        }

        resetSessionTimeout(); // Reset timeout on authenticated activity

        const headers = { ...options.headers, 'Authorization': `Bearer ${token}` };
        // Do not set Content-Type for FormData, browser does it with boundary
        if (options.body && !(options.body instanceof FormData)) {
            headers['Content-Type'] = 'application/json';
        } else if (options.body instanceof FormData) {
            // Let browser set Content-Type for FormData
            delete headers['Content-Type'];
        }

        return fetch(url, { ...options, headers: headers })
            .then(async response => {
                if (response.status === 401 || response.status === 403) {
                    console.error(`Doctor: Authentication error (${response.status}) for ${url}.`);
                    localStorage.removeItem(CONFIG.TOKEN_KEY);
                    localStorage.removeItem(CONFIG.USER_ID_KEY);
                    clearDoctorUI();
                    alert(`Session invalide (${response.status}). Veuillez vous reconnecter.`);
                    redirectToLogin();
                    throw new Error(`Auth failed: ${response.status}`); // Stop further processing in promise chain
                }

                if (!response.ok) {
                    // Try to get more specific error text from the response body
                    let errorText = response.statusText;
                    try {
                        const errorData = await response.text(); // Read as text first
                        // Attempt to parse as JSON, but fallback to text if it fails
                        try {
                            const errorJson = JSON.parse(errorData);
                            errorText = errorJson.message || errorData; // Use message field if available
                        } catch (parseError) {
                            errorText = errorData || response.statusText; // Use raw text if not JSON
                        }
                    } catch (readError) {
                        console.warn(`Could not read error response body for ${url}:`, readError);
                    }
                    console.error(`Doctor: API Error ${response.status} for ${url}: ${errorText}`);
                    throw new Error(`Erreur ${response.status}: ${errorText}`); // Throw detailed error
                }

                // Process successful response
                const contentType = response.headers.get("content-type");
                if (contentType && contentType.includes("application/json")) {
                    const text = await response.text();
                    try {
                        return JSON.parse(text); // Parse JSON response
                    } catch (e) {
                        console.warn(`OK response but invalid JSON received from ${url}. Raw text: ${text}`);
                        // Return a success structure but indicate potential issue
                        return { success: true, data: text, warning: 'Invalid JSON received' };
                    }
                } else {
                    // Handle non-JSON successful responses (e.g., plain text)
                    const text = await response.text();
                    return { success: true, data: text };
                }
            })
            .catch(error => {
                // Catch fetch errors (network, CORS, etc.) and errors thrown above
                console.error(`Fetch error encountered for ${url}:`, error);
                 // Avoid showing duplicate alerts for auth failures handled above
                if (!error.message.startsWith('Auth failed')) {
                   // Show a generic communication error, possibly using a specific element later
                   showMessage('globalRecordMessage', `Erreur de communication: ${error.message}`, 'error');
                }
                // Re-throw the error to allow calling code (.catch) to handle it
                throw error;
            });
    }
    function logout() {
        localStorage.removeItem(CONFIG.TOKEN_KEY);
        localStorage.removeItem(CONFIG.USER_ID_KEY);
        clearTimeout(sessionTimeoutId);
        alert('Vous avez été déconnecté.');
        redirectToLogin();
    }
     function resetSessionTimeout() {
        if (sessionTimeoutId) clearTimeout(sessionTimeoutId);
        sessionTimeoutId = setTimeout(logout, CONFIG.SESSION_TIMEOUT);
     }


    // --- UI CONTROL ---
    function enableDoctorSections(enable) {
        // Select all relevant interactive elements within the dynamic sections
        const allElements = document.querySelectorAll(
            '#globalDictationCardBody button, #consultationForm textarea, #consultationForm button, #aiSuggestion input, #aiSuggestion button, #consultationForm .btn-group button'
        );
        // Select the card bodies to visually disable them
        const allCardBodies = document.querySelectorAll(
             '#globalDictationCardBody, #diagCardBody, #prescCardBody, #antecCardBody, #traitementCardBody, #exploCardBody, #orientCardBody, #notesCardBody'
        );
        // Select only textareas within the main form
        const allTextAreas = document.querySelectorAll('#consultationForm textarea');
        // Select specific stop buttons
        const allStopButtons = document.querySelectorAll('button[id^="stop"]');
        // Final save button and its container
        const finalSaveButton = document.getElementById('saveAllConsultationBtn');
        const finalSaveCardBody = finalSaveButton?.closest('.card-body'); // Find closest card body

        if (enable && currentVisitId) { // Enable only if a visit ID is loaded
            allCardBodies.forEach(el => { if (el) { el.style.opacity = '1'; el.style.pointerEvents = 'auto'; }});
            allElements.forEach(el => { if (el) el.disabled = false; });
            allTextAreas.forEach(ta => { if (ta) ta.readOnly = false; });
            // Ensure stop buttons are initially disabled after enabling
            allStopButtons.forEach(btn => { if (btn) btn.disabled = true; });
            // Keep AI suggestion hidden until explicitly shown
            if (aiSuggestionDiv) aiSuggestionDiv.style.display = 'none';
             // Enable the final save section
            if (finalSaveCardBody) { finalSaveCardBody.style.opacity = '1'; finalSaveCardBody.style.pointerEvents = 'auto'; }
            if(finalSaveButton) finalSaveButton.disabled = false;

        } else { // Disable sections
            allCardBodies.forEach(el => { if (el) { el.style.opacity = '0.5'; el.style.pointerEvents = 'none'; } });
            allElements.forEach(el => { if (el) el.disabled = true; });
            allTextAreas.forEach(ta => { if (ta) { ta.readOnly = true; /* Don't clear value on disable, only on new patient load */ } });
            // Explicitly disable stop buttons
            allStopButtons.forEach(btn => { if (btn) btn.disabled = true; });
            // Hide AI suggestion
            if (aiSuggestionDiv) aiSuggestionDiv.style.display = 'none';
            // Stop any active recordings
             if (mediaRecorder?.state === 'recording') stopRecording(recordingField);
             if (globalMediaRecorder?.state === 'recording') stopGlobalRecording();
            // Reset recording state variables
            isGlobalRecording = false; globalMediaRecorder = null; globalAudioChunks = [];
            recordingField = null; mediaRecorder = null; audioChunks = [];
            // Clear status indicators and messages within the disabled sections
            document.querySelectorAll('.status').forEach(span => span.innerHTML = '');
            document.querySelectorAll('#consultationForm .message, #globalRecordMessage').forEach(div => { div.innerHTML = ''; div.style.display = 'none'; });
            // Show warning if enable=true but no visitId (shouldn't normally happen due to check above)
            if (enable && !currentVisitId) showMessage('globalRecordMessage', "Erreur: Activation UI sans ID de visite.", 'warning');
            // Disable the final save section
            if (finalSaveCardBody) { finalSaveCardBody.style.opacity = '0.5'; finalSaveCardBody.style.pointerEvents = 'none'; }
            if(finalSaveButton) finalSaveButton.disabled = true;
        }
    }

    function clearDoctorUI() {
        currentIPP = null; currentVisitId = null;
         // Reset patient info display
        if (patientInfoDiv) patientInfoDiv.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;"><i class="fas fa-qrcode"></i><div class="empty-state-message">Prêt à scanner</div><div class="empty-state-description">Scannez le QR code du patient.</div></div>`;
        // Hide nurse data
        if (nurseDataDisplayDiv) nurseDataDisplayDiv.style.display = 'none';
        // Clear all form fields
        if(consultationForm) consultationForm.reset(); // Resets all form inputs/textareas
         // Explicitly clear textareas just in case reset() doesn't cover edge cases
         document.querySelectorAll('#consultationForm textarea').forEach(ta => { ta.value = ''; });
        // Clear AI suggestion box content and hide it
        if(aiSuggestionDiv) {
            aiSuggestionDiv.innerHTML = ''; // Clear previous suggestions
            aiSuggestionDiv.style.display = 'none';
        }
        // Clear all messages and status indicators
        document.querySelectorAll('.message').forEach(div => { div.innerHTML = ''; div.style.display = 'none'; });
        document.querySelectorAll('.status').forEach(span => span.innerHTML = '');
        // Disable all interactive sections
        enableDoctorSections(false);
        // Remove IPP from URL
        try {
            const url = new URL(window.location);
            url.searchParams.delete('ipp');
            window.history.replaceState({}, '', url);
        } catch (e) {
            console.error("History API error:", e);
        }
         console.log("Doctor UI cleared.");
    }


    // --- DATA LOADING ---
    function loadPatientVisitData(ipp) {
         console.log(`Loading Doctor Visit Data for IPP: ${ipp}`);
         if (!patientInfoDiv || !ipp) {
             console.error("Missing patientInfoDiv or IPP for loading.");
             clearDoctorUI(); // Ensure UI is cleared if loading cannot proceed
             return;
         }
         // Show loading state
         patientInfoDiv.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 20px;"><i class="fas fa-spinner fa-spin fa-2x"></i><p style="margin-top:10px;">Chargement patient/visite...</p></div>`;
         if (nurseDataDisplayDiv) nurseDataDisplayDiv.style.display = 'none';
         enableDoctorSections(false); // Keep UI disabled during load

         fetchWithAuth(`${CONFIG.API_BASE_URL}${CONFIG.GET_VISIT_DETAILS_ENDPOINT}?ipp=${ipp}`)
            .then(responseData => {
                 console.log("Doctor Visit Details Response:", responseData);
                 if (!responseData || !responseData.success || !responseData.patientData || responseData.visitId === undefined || responseData.visitId === null) {
                    // Use the message from backend if available, otherwise a default
                    throw new Error(responseData?.message || "Visite active ou patient introuvable.");
                 }

                 const patientData = responseData.patientData;
                 currentIPP = patientData.ipp;
                 currentVisitId = responseData.visitId; // Store active visit ID globally
                 const nurseObservations = responseData.nurseObservations || {};
                 const vitalSigns = responseData.vitalSigns || {};
                 console.log(`Data Loaded - IPP: ${currentIPP}, Visit ID: ${currentVisitId}`);

                 // Populate Patient Info Grid
                 patientInfoDiv.innerHTML = `
                     <div class="info-group"><div class="info-label">Nom</div><div class="info-value">${sanitizeInput(patientData.nom)}</div></div>
                     <div class="info-group"><div class="info-label">Prénom</div><div class="info-value">${sanitizeInput(patientData.prenom)}</div></div>
                     <div class="info-group"><div class="info-label">IPP</div><div class="info-value">${sanitizeInput(currentIPP)}</div></div>
                     <div class="info-group"><div class="info-label">Visite ID</div><div class="info-value" style="font-weight:bold;">${sanitizeInput(currentVisitId)}</div></div>
                     <div class="info-group"><div class="info-label">Naissance</div><div class="info-value">${formatDate(patientData.date_naissance)}</div></div>
                     <div class="info-group"><div class="info-label">Sexe</div><div class="info-value">${sanitizeInput(patientData.sexe === 'M' ? 'Homme' : patientData.sexe === 'F' ? 'Femme' : '-')}</div></div>
                     <div class="info-group"><div class="info-label">Téléphone</div><div class="info-value">${sanitizeInput(patientData.telephone || '-')}</div></div>
                     <div class="info-group"><div class="info-label">Mutuelle</div><div class="info-value">${sanitizeInput(patientData.mutuelle || 'Aucune')}</div></div>
                 `;

                 displayNurseData(nurseObservations, vitalSigns); // Display nurse data

                 // Fetch and populate existing DOCTOR notes for this specific visit
                 // We use 'await' here by making the .then callback async
                 return fetchDoctorNotes(currentVisitId); // Chain the promise
            })
            .then(() => {
                 // This block runs after patient info is displayed AND fetchDoctorNotes has completed (successfully or not)
                 enableDoctorSections(true); // Enable UI now that all initial data loading is attempted
                 showMessage('globalRecordMessage', `Patient ${patientInfoDiv.querySelector('.info-value')?.textContent || ''} chargé (Visite ID: ${currentVisitId}).`, 'success');
                 window.scrollTo({ top: 0, behavior: 'smooth' }); // Scroll to top after load
            })
            .catch(err => {
                 console.error("Error loading doctor visit data or fetching notes:", err);
                 // Display error in patient info area as it's the main loading indicator
                 patientInfoDiv.innerHTML = `<div class="message message-error" style="display:block; grid-column: 1 / -1;">❌ Erreur chargement visite: ${err.message}</div>`;
                 clearDoctorUI(); // Reset the UI state on critical loading failure
                 // Optionally show error in global message area too
                 // showMessage('globalRecordMessage', `Erreur chargement visite: ${err.message}`, 'error');
            });
    }

    function displayNurseData(observations, vitals) {
        const obsDisplay = document.getElementById('nurseObservationsDisplay');
        const vitalsDisplay = document.getElementById('nurseVitalsDisplay');
        let obsHtml = '<p><strong>Observation:</strong> <span>Aucune observation infirmière enregistrée.</span></p>';
        let vitalsHtml = '<p><strong>Signes Vitaux (derniers):</strong> <span>Aucun signe vital enregistré.</span></p>';

        // Display Observations
        if (observations && observations.observation_text) {
            const obsDate = observations.observation_date_time ? `(${formatDate(observations.observation_date_time, true)})` : '';
            obsHtml = `<p><strong>Observation ${obsDate}:</strong> ${sanitizeInput(observations.observation_text)}</p>`;
        }
        if (obsDisplay) obsDisplay.innerHTML = obsHtml;

        // Display Vital Signs
        if (vitals && vitals.timestamp) {
            let parts = [`<span style="font-size:0.8em;">(${formatDate(vitals.timestamp, true)})</span>`];
            if (vitals.temperature != null) parts.push(`Temp: ${vitals.temperature}°C`);
            if (vitals.tension_systolic != null && vitals.tension_diastolic != null) parts.push(`TA: ${vitals.tension_systolic}/${vitals.tension_diastolic} mmHg`);
            if (vitals.heart_rate != null) parts.push(`FC: ${vitals.heart_rate}/min`);
            if (vitals.spo2 != null) parts.push(`SpO₂: ${vitals.spo2}%`);
            // Add other vitals if available (e.g., respiratory rate, pain score)

            if (parts.length > 1) { // Only display if there are actual vitals beyond the timestamp
                vitalsHtml = `<p><strong>Signes Vitaux (derniers):</strong> ${parts.join(', ')}</p>`;
            }
        }
        if (vitalsDisplay) vitalsDisplay.innerHTML = vitalsHtml;

        // Show the nurse data container
        if (nurseDataDisplayDiv) nurseDataDisplayDiv.style.display = 'block';
    }

     async function fetchDoctorNotes(visitId) {
         if (!visitId) {
              console.warn("fetchDoctorNotes called without visitId.");
              populateDoctorFields({}); // Populate with empty data if no ID
              return; // Don't attempt fetch
         }
         console.log(`Fetching existing doctor notes for Visit ID: ${visitId}...`);
         // Display loading message specifically for notes? Optional.
         // showMessage('saveConsultationMessage', 'Chargement notes médecin...', 'loading');

         try {
             // Use GET method to fetch existing data from the update endpoint
             const response = await fetchWithAuth(`${CONFIG.API_BASE_URL}${CONFIG.UPDATE_CONSULTATION_ENDPOINT}?visit_id=${visitId}`); // GET is default

             // Clear loading message if shown
             // showMessage('saveConsultationMessage', '', '');

             if (response && response.success && response.data && typeof response.data === 'object' && Object.keys(response.data).length > 0) {
                 console.log("Existing doctor notes received:", response.data);
                 populateDoctorFields(response.data);
             } else if (response && response.success && (!response.data || Object.keys(response.data).length === 0)) {
                 console.log("No existing doctor notes found for this visit.");
                 populateDoctorFields({}); // Ensure fields are cleared/empty if no data
             } else {
                 // Handle unexpected success=true but invalid data structure
                 console.warn("Failed to fetch doctor notes or unexpected response structure:", response);
                 populateDoctorFields({});
                 // Optionally show a warning message
                 showMessage('saveConsultationMessage', 'Notes médecin non trouvées ou format invalide.', 'warning');
             }
         } catch(error) {
             // fetchWithAuth already logs the error and handles auth failures
             // Display error specific to fetching notes
             console.error("Failed to fetch doctor notes:", error); // Keep detailed log
             showMessage('globalRecordMessage', `Erreur chargement notes: ${error.message}`, 'error');
             populateDoctorFields({}); // Ensure fields are empty on error
             // We re-throw the error so the catch block in loadPatientVisitData can handle the overall failure
             throw error;
         }
     }

    function populateDoctorFields(notes) {
        console.log("Populating doctor fields with data:", notes);
        if(!notes || typeof notes !== 'object') notes = {}; // Ensure notes is an object

        const fieldsMap = {
            diagnostic: 'diagnosticInput',
            ordonnance_medicale: 'prescriptionInput',
            antecedents: 'antecedentsInput',
            traitement_en_cours: 'traitementInput',
            prescription_exploration: 'explorationInput',
            orientation: 'orientationInput',
            notes_supplementaires: 'notesInput'
        };

        Object.entries(fieldsMap).forEach(([backendKey, elementId]) => {
            const el = document.getElementById(elementId);
            if (el) {
                // Use nullish coalescing to default to empty string if key is missing or null/undefined
                el.value = notes[backendKey] ?? '';
            } else {
                 console.warn(`Element ID ${elementId} not found during population for key ${backendKey}.`);
            }
        });
        console.log("Doctor fields population attempt complete.");
    }

    // --- QR SCANNER ---
    let scanning = false; let currentStream = null; let scanTimeout = null;
    function updateScanStatus(message, type = 'info') { showMessage('scanResult', message, type); }

    if (scanButton) {
        scanButton.onclick = async () => {
            if (!scanning) { // Start scanning
                try {
                    updateScanStatus('', 'info'); // Clear previous result
                    if(!scannerContainer || !video) throw new Error("Scanner elements missing.");
                    scannerContainer.style.display = 'block';
                    updateScanStatus('Recherche caméra...', 'loading');
                    currentStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
                    video.srcObject = currentStream;
                    // Ensure video plays inline on iOS
                    video.setAttribute('playsinline', true);
                    await video.play();
                    updateScanStatus('Caméra prête. Scannez le QR code.', 'info');
                    scanButton.innerHTML = '<i class="fas fa-stop-circle"></i> Arrêter Scan';
                    scanButton.classList.replace('btn-primary','btn-danger');
                    scanning = true;
                    clearTimeout(scanTimeout); // Clear any previous timeout
                    // Set a timeout for scanning (e.g., 30 seconds)
                    scanTimeout = setTimeout(() => {
                        if (scanning) {
                            updateScanStatus('Aucun code QR détecté.', 'warning');
                            stopScanner();
                        }
                    }, 30000); // 30 seconds timeout
                    requestAnimationFrame(tick); // Start the scanning loop
                } catch (err) {
                    console.error("Camera/Scan Error:", err);
                    let errMsg = err.message;
                     if (err.name === 'NotAllowedError') {
                         errMsg = "Permission d'accès caméra refusée.";
                     } else if (err.name === 'NotFoundError') {
                         errMsg = "Aucune caméra compatible trouvée.";
                     }
                    updateScanStatus(`Erreur Caméra: ${errMsg}`, 'error');
                    stopScanner(); // Ensure scanner stops on error
                }
            } else { // Stop scanning
                stopScanner();
                updateScanStatus('Scan arrêté par l\'utilisateur.', 'info');
            }
        };
    } else {
        console.warn("Scan button (scanQrButton) not found.");
    }

    function stopScanner() {
        clearTimeout(scanTimeout); // Clear the timeout
        scanning = false;
        if (currentStream) {
            currentStream.getTracks().forEach(track => track.stop()); // Stop camera stream
            currentStream = null;
        }
        if(video) video.srcObject = null; // Release video source
        if(scannerContainer) scannerContainer.style.display = 'none'; // Hide container
        if(scanButton) { // Reset button appearance
            scanButton.innerHTML = '<i class="fas fa-qrcode"></i> Scanner QR';
            scanButton.classList.replace('btn-danger','btn-primary');
        }
        console.log("QR Scanner stopped.");
    }

    function tick() {
        // Stop if not scanning, video not ready, or stream lost
        if (!scanning || !video || video.readyState < video.HAVE_ENOUGH_DATA || !currentStream) {
             if (scanning) requestAnimationFrame(tick); // Keep trying if scanning should be active
            return;
        }

        const canvasElement = document.createElement('canvas');
        canvasElement.height = video.videoHeight;
        canvasElement.width = video.videoWidth;
        const canvas = canvasElement.getContext("2d", { willReadFrequently: true }); // Opt-in for performance
        canvas.drawImage(video, 0, 0, canvasElement.width, canvasElement.height);

        try {
            const imageData = canvas.getImageData(0, 0, canvasElement.width, canvasElement.height);
            // Ensure jsQR is loaded
            if (typeof jsQR === 'undefined') {
                 console.error("jsQR library not loaded!");
                 updateScanStatus("Erreur: Librairie QR manquante.", "error");
                 stopScanner();
                 return;
            }
            const code = jsQR(imageData.data, imageData.width, imageData.height, {
                inversionAttempts: "dontInvert", // Standard QR codes
            });

            if (code?.data) {
                console.log("QR Code Found:", code.data);
                stopScanner(); // Stop scanning immediately on success
                processScannedQrCode(code.data); // Process the found code
            } else {
                requestAnimationFrame(tick); // No code found, continue scanning
            }
        } catch (e) {
            console.error("QR processing error:", e);
            requestAnimationFrame(tick); // Continue scanning even on processing error
        }
    }

    function processScannedQrCode(scannedUrl) {
        clearTimeout(scanTimeout); // Ensure timeout is cleared
        updateScanStatus('Code détecté. Traitement...', 'loading');
        try {
            // Validate the scanned URL structure
            if (!scannedUrl || !scannedUrl.startsWith(CONFIG.QR_TARGET_BASE_URL)) {
                 throw new Error(`Format QR code non reconnu. Attendu: ${CONFIG.QR_TARGET_BASE_URL}...`);
            }
            const url = new URL(scannedUrl);
            const ippFromQr = url.searchParams.get('ipp');

            if (ippFromQr) {
                updateScanStatus(`Patient IPP ${ippFromQr} trouvé. Chargement des données...`, 'success');
                // Load patient data into the dashboard
                loadPatientIntoCurrentDashboard(ippFromQr);
            } else {
                throw new Error('Paramètre IPP manquant dans le QR code.');
            }
        } catch (e) {
            console.error("QR processing error:", e);
            updateScanStatus(`Erreur traitement QR: ${e.message}`, 'error');
             // Clear UI as the scan was invalid
            clearDoctorUI();
        }
    }

    function loadPatientIntoCurrentDashboard(ipp) {
        console.log(`Loading patient ${ipp} into Doctor dashboard`);
        // Clear previous patient state FIRST
        clearDoctorUI(); // Clears fields, messages, disables sections, stops recordings
        currentIPP = ipp; // Set new IPP

        // Update URL without reloading page
        try {
            const newUrl = new URL(window.location);
            newUrl.searchParams.set('ipp', ipp);
            window.history.replaceState({}, '', newUrl);
        } catch(e) {
            console.error("History API error:", e);
        }

        // Clear scan result message after a short delay
        setTimeout(() => { updateScanStatus('', ''); }, 3000);

        console.log("Calling loadPatientVisitData for new patient...");
        // Load data for the new patient (this will re-enable sections on success)
        loadPatientVisitData(ipp);
        // Scroll to top is handled within loadPatientVisitData's success path now
    }

    // --- AUDIO RECORDING ---

     // ** CORRECTED getFieldConfig **
     function getFieldConfig(field) {
         // Map field names to their UI elements and specific API endpoints
         const map = {
             diagnostic: {
                 inputId: 'diagnosticInput', statusId: 'diagnosisStatus', messageId: 'diagMessage',
                 startBtnId: 'startDiagRecordBtn', stopBtnId: 'stopDiagRecordBtn',
                 apiField: 'diagnostic', // Original key, useful for backend logic if needed
                 apiEndpoint: '/webhook/transcribe-diagnosis' // Specific Endpoint
             },
             ordonnance_medicale: {
                 inputId: 'prescriptionInput', statusId: 'ordonnance_medicaleStatus', messageId: 'validationMessage',
                 startBtnId: 'startPrescRecordBtn', stopBtnId: 'stopPrescRecordBtn',
                 apiField: 'ordonnance_medicale',
                 apiEndpoint: '/webhook/transcribe-prescription' // Specific Endpoint
             },
             antecedents: {
                 inputId: 'antecedentsInput', statusId: 'antecedentsStatus', messageId: 'antecedentsMessage',
                 startBtnId: 'startAntecedentsRecordBtn', stopBtnId: 'stopAntecedentsRecordBtn',
                 apiField: 'antecedents',
                 apiEndpoint: '/webhook/transcribe-antecedents' // Specific Endpoint
             },
             traitement_en_cours: {
                 inputId: 'traitementInput', statusId: 'traitement_en_coursStatus', messageId: 'traitementMessage',
                 startBtnId: 'startTraitementRecordBtn', stopBtnId: 'stopTraitementRecordBtn',
                 apiField: 'traitement_en_cours',
                 apiEndpoint: '/webhook/transcribe-treatment' // Specific Endpoint (assuming this path)
             },
             prescription_exploration: {
                 inputId: 'explorationInput', statusId: 'prescription_explorationStatus', messageId: 'explorationMessage',
                 startBtnId: 'startExplorationRecordBtn', stopBtnId: 'stopExplorationRecordBtn',
                 apiField: 'prescription_exploration',
                 apiEndpoint: '/webhook/transcribe-exploration' // Specific Endpoint
             },
             orientation: {
                 inputId: 'orientationInput', statusId: 'orientationStatus', messageId: 'orientationMessage',
                 startBtnId: 'startOrientationRecordBtn', stopBtnId: 'stopOrientationRecordBtn',
                 apiField: 'orientation',
                 apiEndpoint: '/webhook/transcribe-orientation' // Specific Endpoint
             },
             notes_supplementaires: {
                 inputId: 'notesInput', statusId: 'notes_supplementairesStatus', messageId: 'notesMessage',
                 startBtnId: 'startNotesRecordBtn', stopBtnId: 'stopNotesRecordBtn',
                 apiField: 'notes_supplementaires',
                 apiEndpoint: '/webhook/transcribe-notes' // Specific Endpoint
             }
         };
         return map[field]; // Return the config object for the requested field
     }

     function startRecording(field) {
         const config = getFieldConfig(field);
         if (!config) { console.error(`Invalid field specified for recording: ${field}`); return; }
         if (!currentIPP || !currentVisitId) { alert("Veuillez d'abord scanner un patient et charger sa visite."); return; }
         if (isGlobalRecording || (mediaRecorder && mediaRecorder.state === 'recording')) { alert("Un autre enregistrement est déjà en cours."); return; }

         audioChunks = []; // Reset chunks for new recording
         recordingField = field; // Track which field is being recorded

         const statusEl = document.getElementById(config.statusId);
         const startBtn = document.getElementById(config.startBtnId);
         const stopBtn = document.getElementById(config.stopBtnId);
         const messageEl = document.getElementById(config.messageId);

         if(!statusEl || !startBtn || !stopBtn || !messageEl){
             console.error(`UI Elements not found for field recording: ${field}`);
             return;
         }

         showMessage(messageEl.id, '', ''); // Clear previous messages
         statusEl.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Démarrage...';
         statusEl.style.display = 'inline-flex';
         startBtn.disabled = true; // Disable start button
         stopBtn.disabled = false; // Enable stop button

         navigator.mediaDevices.getUserMedia({ audio: true })
             .then(stream => {
                 mediaRecorder = new MediaRecorder(stream); // Create recorder instance

                 mediaRecorder.ondataavailable = e => {
                     if (e.data.size > 0) audioChunks.push(e.data);
                 };

                 mediaRecorder.onstop = () => {
                     // Pass the stream to handleRecordingStop to stop tracks *after* processing
                     handleRecordingStop(stream);
                 };

                 mediaRecorder.onerror = e => {
                     console.error(`Recording Error (${recordingField}):`, e.error || e);
                     if(statusEl) statusEl.innerHTML = '<i class="fas fa-times-circle"></i> Err Rec.';
                     showMessage(messageEl.id, `Erreur enregistrement: ${e.error?.message || 'Inconnue'}`, "error");
                     startBtn.disabled = false; // Re-enable start
                     stopBtn.disabled = true; // Disable stop
                     recordingField = null;
                     mediaRecorder = null;
                     // Stop stream tracks on error as well
                     stream.getTracks().forEach(track => track.stop());
                 };

                 mediaRecorder.start(); // Start recording
                 statusEl.innerHTML = '<i class="fas fa-microphone-alt fa-fade" style="color: var(--danger);"></i> REC...';
                 console.log(`Recording started for field: ${field}`);

             }).catch(err => {
                 console.error("Microphone Access Error:", err);
                 if(statusEl) statusEl.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Err micro';
                 showMessage(messageEl.id, `Accès microphone impossible: ${err.message}`, "error");
                 startBtn.disabled = false; // Re-enable start
                 stopBtn.disabled = true; // Disable stop
                 recordingField = null; // Reset field tracking
             });
     }

     function stopRecording(field) {
         const config = getFieldConfig(field);
         if (!config) { console.warn(`stopRecording called for invalid field: ${field}`); return; }

         const startBtn = document.getElementById(config.startBtnId);
         const stopBtn = document.getElementById(config.stopBtnId);
         const statusEl = document.getElementById(config.statusId); // Added statusEl here

         if (mediaRecorder && mediaRecorder.state === 'recording' && recordingField === field) {
              console.log(`Stopping recording for field: ${field}`);
              mediaRecorder.stop(); // This will trigger the 'onstop' event handler
              // Buttons are re-enabled in 'onstop' or 'onerror' handlers
              if(statusEl) statusEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Arrêt...'; // Indicate stopping
         } else {
             console.log(`Stop called for ${field}, but not actively recording it.`);
             // Ensure buttons are in a consistent state if called unexpectedly
             if(startBtn) startBtn.disabled = false;
             if(stopBtn) stopBtn.disabled = true;
         }
     }

     // Modified to accept the stream to stop tracks after processing
     function handleRecordingStop(stream) {
         const currentField = recordingField; // Capture field at time of stop
         if (!currentField) {
             console.warn("handleRecordingStop called but no recordingField set.");
             if(stream) stream.getTracks().forEach(track => track.stop()); // Stop stream anyway
             return;
         }

         const config = getFieldConfig(currentField);
         if (!config) {
             console.error(`Config not found for stopped field: ${currentField}`);
             if(stream) stream.getTracks().forEach(track => track.stop());
             return;
         }

         console.log(`Recording stopped for ${currentField}. Chunks: ${audioChunks.length}`);
         const statusEl = document.getElementById(config.statusId);
         const messageEl = document.getElementById(config.messageId);
         const startBtn = document.getElementById(config.startBtnId); // Get buttons for finally block
         const stopBtn = document.getElementById(config.stopBtnId);


         if (audioChunks.length === 0) {
             if(statusEl) statusEl.innerHTML = '<i class="fas fa-exclamation-circle"></i> Audio vide';
             showMessage(messageEl.id, "Aucun audio n'a été enregistré.", "warning");
             // Reset buttons immediately if audio is empty
             if(startBtn) startBtn.disabled = false;
             if(stopBtn) stopBtn.disabled = true;
             setTimeout(() => { if (statusEl?.innerHTML.includes('Audio vide')) statusEl.innerHTML = ''; }, 4000);
         } else {
             // Create Blob from chunks
             const blob = new Blob(audioChunks, { type: 'audio/webm' }); // Use webm, common for browsers
             audioChunks = []; // Clear chunks immediately

             if(statusEl) statusEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Transcription...';
             showMessage(messageEl.id, "Envoi pour transcription...", "loading");

             // Send the audio for transcription for this specific field
             sendAudioToAI(blob, currentField); // This function now handles resetting buttons in its finally block
         }

         // Reset state AFTER processing blob or handling empty audio
         recordingField = null;
         mediaRecorder = null;
         // Stop the microphone stream tracks *after* processing
         if (stream) {
              stream.getTracks().forEach(track => track.stop());
              console.log("Microphone stream stopped.");
         }
     }


     // ** CORRECTED sendAudioToAI **
     function sendAudioToAI(blob, field) {
         const config = getFieldConfig(field);

         // Check if config and the specific endpoint exist
         if (!config || !config.apiEndpoint) {
             console.error(`Configuration or specific API endpoint not found for field: ${field}`);
             const msgId = config?.messageId || 'globalRecordMessage';
             showMessage(msgId, `Erreur Configuration: Endpoint manquant pour '${field}'.`, "error");
             // Reset buttons if possible
             const startBtn = document.getElementById(config?.startBtnId);
             const stopBtn = document.getElementById(config?.stopBtnId);
             if(startBtn) startBtn.disabled = false;
             if(stopBtn) stopBtn.disabled = true;
             return;
         }

         if (!currentIPP || !currentVisitId) {
             showMessage(config.messageId, "IPP/Visite ID manquant pour l'envoi.", "error");
              // Reset buttons
             const startBtn = document.getElementById(config.startBtnId);
             const stopBtn = document.getElementById(config.stopBtnId);
             if(startBtn) startBtn.disabled = false;
             if(stopBtn) stopBtn.disabled = true;
             return;
         }

         const formData = new FormData();
         formData.append("audio", blob, `${field}_${currentIPP}_${Date.now()}.webm`); // Add timestamp for uniqueness
         formData.append("ipp", currentIPP);
         formData.append("visit_id", currentVisitId);

         const statusEl = document.getElementById(config.statusId);
         const messageEl = document.getElementById(config.messageId);
         const targetTextarea = document.getElementById(config.inputId);
         const startBtn = document.getElementById(config.startBtnId); // Get buttons for finally block
         const stopBtn = document.getElementById(config.stopBtnId);


         if(statusEl) statusEl.innerHTML = '<i class="fas fa-paper-plane"></i> Envoi...';
         // Use the specific endpoint from the configuration
         const fullUrl = CONFIG.API_BASE_URL + config.apiEndpoint;
         console.log(`Sending audio for field '${field}' to endpoint: ${fullUrl}`);


         fetchWithAuth(fullUrl, { method: "POST", body: formData })
             .then(data => {
                 // Assuming backend returns { success: true, transcript: "..." } for these endpoints
                 console.log(`Transcription response for ${field} from ${config.apiEndpoint}:`, data);

                 let transcript = '';
                 if (data?.success === true && typeof data.transcript === 'string') {
                     transcript = data.transcript;
                 } else if (data?.success === false) {
                      // Use message from backend if provided
                     throw new Error(data.message || `Échec transcription pour ${field}`);
                 } else {
                     // Handle unexpected structure or missing transcript even if success=true
                     console.warn(`Unexpected transcription response structure or missing transcript for ${field} from ${config.apiEndpoint}:`, data);
                     throw new Error(`Réponse transcription invalide pour ${field}.`);
                 }

                 if (transcript === null || transcript === undefined) { // Check explicitly for null/undefined if backend might return that
                      console.warn("Transcription vide (null/undefined) reçue:", data);
                      if(statusEl) statusEl.innerHTML = '<i class="fas fa-exclamation-circle"></i> Vide';
                      showMessage(messageEl.id, "Transcription vide reçue.", "warning");
                      if(targetTextarea) targetTextarea.value = ''; // Ensure field is cleared
                 } else { // Includes empty string "" as valid
                     if(targetTextarea) targetTextarea.value = transcript; // Populate textarea
                     if(statusEl) statusEl.innerHTML = '<i class="fas fa-check"></i> OK';
                     showMessage(messageEl.id, '', ''); // Clear message on success
                 }
             })
             .catch(e => {
                  // fetchWithAuth handles generic comms/auth errors and logs them
                 if (!e.message.startsWith('Auth')){ // Avoid duplicate messages for auth failures
                     if(statusEl) statusEl.innerHTML = '<i class="fas fa-times-circle"></i> Erreur';
                     // Show specific error message caught from .then block or fetch
                     showMessage(messageEl.id, `Erreur Transc.: ${e.message}`, "error");
                 }
                 // Keep detailed log
                 console.error(`Transcription error for ${field} using ${config.apiEndpoint}:`, e);
             })
             .finally(() => {
                  // Ensure buttons are ALWAYS reset after the fetch completes or fails
                 if(startBtn) startBtn.disabled = false;
                 if(stopBtn) stopBtn.disabled = true; // Stop should be disabled when not recording

                 // Clear the status indicator after a delay
                 setTimeout(() => {
                     const currentStatusHTML = statusEl?.innerHTML;
                     if (currentStatusHTML && (currentStatusHTML.includes('OK') || currentStatusHTML.includes('Erreur') || currentStatusHTML.includes('Vide'))) {
                          statusEl.innerHTML = '';
                     }
                 }, 4000);
             });
     }


    // --- GLOBAL DICTATION (Remains largely the same, uses its own endpoint) ---
     function startGlobalRecording() {
          if (!currentIPP || !currentVisitId) { showMessage('globalRecordMessage', "Chargez patient/visite.", "warning"); return; }
          if (isGlobalRecording || (mediaRecorder?.state === 'recording')) { showMessage('globalRecordMessage', "Autre enregistrement en cours.", "warning"); return; }

          globalAudioChunks = [];
          isGlobalRecording = true;
          const statusEl = document.getElementById('globalRecordStatus');
          const startBtn = document.getElementById('startGlobalRecordBtn');
          const stopBtn = document.getElementById('stopGlobalRecordBtn');
          const messageEl = document.getElementById('globalRecordMessage');

          showMessage(messageEl.id, '', '');
          statusEl.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Démarrage...';
          statusEl.style.display = 'inline-flex';
          if(startBtn) startBtn.disabled = true;
          if(stopBtn) stopBtn.disabled = false;

          navigator.mediaDevices.getUserMedia({ audio: true })
             .then(stream => {
                 globalMediaRecorder = new MediaRecorder(stream);
                 globalMediaRecorder.ondataavailable = e => { if (e.data.size > 0) globalAudioChunks.push(e.data); };
                 // Pass stream to stop handler
                 globalMediaRecorder.onstop = () => handleGlobalRecordingStop(stream);
                 globalMediaRecorder.onerror = e => {
                     console.error(`Global Rec Err: ${e.error?.name}`);
                     if(statusEl) statusEl.innerHTML = '<i class="fas fa-times-circle"></i> Err Enreg.';
                     showMessage(messageEl.id, `Err Enreg.: ${e.error?.message}`, "error");
                     if(startBtn) startBtn.disabled = false;
                     if(stopBtn) stopBtn.disabled = true;
                     isGlobalRecording = false;
                     globalMediaRecorder = null;
                      // Stop stream tracks on error
                     stream.getTracks().forEach(track => track.stop());
                 };
                 globalMediaRecorder.start();
                 statusEl.innerHTML = '<i class="fas fa-microphone-alt fa-fade" style="color: var(--danger);"></i> Enregistrement...';
             })
             .catch(err => {
                 console.error("Global Mic Err:", err);
                 if(statusEl) statusEl.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Err micro';
                 showMessage(messageEl.id, "Accès micro impossible: " + err.message, "error");
                 if(startBtn) startBtn.disabled = false;
                 if(stopBtn) stopBtn.disabled = true;
                 isGlobalRecording = false;
             });
      }

     function stopGlobalRecording() {
         const startBtn = document.getElementById('startGlobalRecordBtn');
         const stopBtn = document.getElementById('stopGlobalRecordBtn');
         const statusEl = document.getElementById('globalRecordStatus');
         if (globalMediaRecorder?.state === 'recording') {
             if (statusEl) statusEl.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Finalisation...';
             globalMediaRecorder.stop(); // Triggers onstop
         } else {
             if(startBtn) startBtn.disabled = false; // Should already be disabled, but good practice
         }
         // Disable stop button immediately
         if(stopBtn) stopBtn.disabled = true;
     }

     // Modified to accept stream
     function handleGlobalRecordingStop(stream) {
         console.log(`Global recording stopped. Chunks: ${globalAudioChunks.length}`);
         const statusEl = document.getElementById('globalRecordStatus');
         const startBtn = document.getElementById('startGlobalRecordBtn');
         const stopBtn = document.getElementById('stopGlobalRecordBtn'); // Already disabled by stopGlobalRecording

         isGlobalRecording = false; // Update state
         globalMediaRecorder = null; // Clear recorder instance

         if (globalAudioChunks.length === 0) {
             if (statusEl) statusEl.innerHTML = '<i class="fas fa-exclamation-circle"></i> Vide';
             showMessage('globalRecordMessage', "Aucun audio enregistré.", "warning");
             if(startBtn) startBtn.disabled = false; // Re-enable start button
              // Reset buttons immediately if audio is empty
             if(startBtn) startBtn.disabled = false;
             if(stopBtn) stopBtn.disabled = true;
             setTimeout(() => { if (statusEl?.innerHTML.includes('Vide')) statusEl.innerHTML = ''; }, 4000);
         } else {
             const blob = new Blob(globalAudioChunks, { type: 'audio/webm' });
             globalAudioChunks = []; // Clear chunks
             if (statusEl) statusEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Traitement IA...';
             showMessage('globalRecordMessage',"Analyse IA et extraction des champs...", "loading");
             // Send audio to the specific global processing backend
             sendGlobalAudioToBackend(blob); // This function handles button state in finally
         }

          // Stop stream tracks *after* processing
          if(stream) stream.getTracks().forEach(track => track.stop());
     }

     function sendGlobalAudioToBackend(blob) {
         if (!currentIPP || !currentVisitId) {
             showMessage('globalRecordMessage', "Erreur: Patient/Visite non identifié.", "error");
             const startBtn = document.getElementById('startGlobalRecordBtn');
             if(startBtn) startBtn.disabled = false;
             return;
         }
         // Use the specific global endpoint from CONFIG
         const endpoint = CONFIG.API_BASE_URL + CONFIG.GLOBAL_DICTATION_ENDPOINT;
         const formData = new FormData();
         formData.append("audio", blob, `global_dictation_${currentIPP}_${Date.now()}.webm`);
         formData.append("ipp", currentIPP);
         formData.append("visit_id", currentVisitId);

         const startBtn = document.getElementById('startGlobalRecordBtn');
         const statusEl = document.getElementById('globalRecordStatus');
         const messageEl = document.getElementById('globalRecordMessage');

         console.log(`Sending global audio to endpoint: ${endpoint}`);

         fetchWithAuth(endpoint, { method: "POST", body: formData })
             .then(data => {
                 console.log("Global processing response:", data);
                  // Expect backend to return { success: true, extractedData: {...}, message: "..." }
                 if (data.success && data.extractedData && typeof data.extractedData === 'object') {
                     showMessage(messageEl.id, `<i class="fas fa-check-circle"></i> ${data.message || 'Dictée complète traitée.'}`, 'success');
                     if (statusEl) statusEl.innerHTML = '<i class="fas fa-check"></i> OK';
                     populateDoctorFields(data.extractedData); // Populate multiple fields
                     document.getElementById('diagnosticInput')?.focus(); // Focus first field after population
                 } else {
                      // Use backend message if available
                     throw new Error(data.message || "Erreur backend (données extraites manquantes ou invalides).");
                 }
             })
             .catch(e => {
                 console.error("Error processing global audio:", e);
                 if (!e.message.startsWith('Auth')) { // Avoid duplicate auth messages
                     showMessage(messageEl.id, `<i class="fas fa-times-circle"></i> Erreur Traitement Global: ${e.message}`, 'error');
                     if (statusEl) statusEl.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Échec';
                 }
             })
             .finally(() => {
                  // Always re-enable start button and ensure stop is disabled
                 if(startBtn) startBtn.disabled = false;
                 const stopBtn = document.getElementById('stopGlobalRecordBtn');
                 if (stopBtn) stopBtn.disabled = true;
                  // Clear status indicator after delay
                 setTimeout(() => {
                     const currentStatusHTML = statusEl?.innerHTML;
                     if (currentStatusHTML && (currentStatusHTML.includes('OK') || currentStatusHTML.includes('Échec'))) {
                         statusEl.innerHTML = '';
                     }
                 }, 5000);
             });
     }


    // --- SAVING CONSULTATION DATA ---
    function saveIndividualField(fieldName, inputElementId, messageElementId, buttonElementId) {
        const inputElement = document.getElementById(inputElementId);
        const saveButton = document.getElementById(buttonElementId);

        if (!currentVisitId) { showMessage(messageElementId, "ID Visite manquant pour sauvegarde.", "error"); return; }
        if (!inputElement) { console.error(`Input element ${inputElementId} not found for saving.`); showMessage(messageElementId, "Erreur interne: Champ introuvable.", "error"); return; }
        if (!saveButton) { console.warn(`Save button ${buttonElementId} not found.`); } // Log warning but proceed if possible

        const textValue = inputElement.value; // Get current value
        const payload = {
            visit_id: currentVisitId,
            doctor_identifier: currentUserIdentifier,
            [fieldName]: textValue // Send only the specific field being saved
        };

        showMessage(messageElementId, '<i class="fas fa-spinner fa-spin"></i> Enregistrement...', 'loading');
        if(saveButton) saveButton.disabled = true; // Disable button during save

        fetchWithAuth(CONFIG.API_BASE_URL + CONFIG.UPDATE_CONSULTATION_ENDPOINT, {
            method: 'POST',
            body: JSON.stringify(payload)
        })
        .then(data => {
             // Assuming backend returns { success: true, message: "..." }
            if (data.success) {
                showMessage(messageElementId, `<i class="fas fa-check-circle"></i> ${data.message || 'Enregistré.'}`, 'success');
            } else {
                throw new Error(data.message || "Échec de la sauvegarde côté serveur.");
            }
        })
        .catch(e => {
            if (!e.message.startsWith('Auth')) { // Avoid duplicate auth messages
                 showMessage(messageElementId, `<i class="fas fa-times-circle"></i> Erreur sauvegarde: ${e.message}`, 'error');
            }
            console.error(`Error saving field ${fieldName}:`, e);
        })
        .finally(() => {
            if(saveButton) saveButton.disabled = false; // Re-enable button
        });
    }

    // --- Remove individual save functions if direct calls in HTML are okay ---
    // The direct calls in the HTML like onclick="saveIndividualField('diagnostic', 'diagnosticInput', 'diagMessage', this.id)" are actually more robust as they pass the button's ID directly.


    // Save All Function (triggered by form submit)
    function saveAllConsultationData() {
        if (!currentVisitId) { showMessage('saveConsultationMessage', "Contexte visite manquant pour sauvegarde complète.", "error"); return; }
        if (!consultationForm) { console.error("Consultation form not found!"); showMessage('saveConsultationMessage', "Erreur interne: Formulaire introuvable.", "error"); return; }

        const saveButton = document.getElementById('saveAllConsultationBtn');
        showMessage('saveConsultationMessage', '<i class="fas fa-spinner fa-spin"></i> Enregistrement complet en cours...', 'loading');
        if(saveButton) saveButton.disabled = true;

        const formData = new FormData(consultationForm);
        const payload = {
            visit_id: currentVisitId,
            doctor_identifier: currentUserIdentifier
        };
        // Populate payload with all form fields
        for (const [key, value] of formData.entries()) {
            // Assign null if value is empty string after trimming, otherwise use trimmed value
             payload[key] = value.trim() === '' ? null : value.trim();
        }

        console.log("Saving all consultation data:", payload);

        fetchWithAuth(CONFIG.API_BASE_URL + CONFIG.UPDATE_CONSULTATION_ENDPOINT, {
             method: 'POST',
             body: JSON.stringify(payload)
        })
        .then(data => {
            if (data.success) {
                showMessage('saveConsultationMessage', `<i class="fas fa-check-circle"></i> ${data.message || 'Consultation complète enregistrée.'}`, 'success');
                // Optionally disable form fields again after successful save all? Or maybe navigate away?
                // Example: consultationForm.querySelectorAll('textarea, button').forEach(el => el.disabled = true);
            } else {
                throw new Error(data.message || "Échec de la sauvegarde complète côté serveur.");
            }
        })
        .catch(e => {
            if (!e.message.startsWith('Auth')) {
                 showMessage('saveConsultationMessage', `<i class="fas fa-times-circle"></i> Erreur sauvegarde complète: ${e.message}`, 'error');
            }
            console.error(`Error saving all consultation data:`, e);
        })
        .finally(() => {
            if(saveButton) saveButton.disabled = false; // Re-enable save button
        });
    }


    // --- PRESCRIPTION AI ---
    function submitPrescriptionToAI() {
        const prescInput = document.getElementById("prescriptionInput");
        const submitBtn = document.getElementById("submitPrescBtn");
        const messageEl = document.getElementById("validationMessage"); // Message area for this card

        if (!prescInput) { console.error("Prescription input not found."); return; }
        if (!submitBtn) { console.warn("Submit prescription button not found."); }

        const prescriptionText = prescInput.value.trim();

        if (!prescriptionText) { showMessage(messageEl.id, `Veuillez saisir ou dicter une prescription.`, "warning"); return; }
        if (!currentIPP || !currentVisitId) { showMessage(messageEl.id, `Patient/Visite non chargé. Impossible d'analyser.`, "warning"); return; }

        showMessage(messageEl.id, "", ""); // Clear previous messages
        if (aiSuggestionDiv) {
            aiSuggestionDiv.style.display = "block"; // Show the box
            aiSuggestionDiv.innerHTML = `<h3><i class="fas fa-lightbulb"></i> Suggestion Structurée (IA)</h3><div class="message message-loading" style="display:block;"><i class="fas fa-spinner fa-spin"></i> Analyse IA de la prescription en cours...</div>`; // Loading state
        }
        if(submitBtn) submitBtn.disabled = true; // Disable button

        fetchWithAuth(CONFIG.API_BASE_URL + CONFIG.SUBMIT_PRESCRIPTION_AI_ENDPOINT, {
            method: "POST",
            body: JSON.stringify({ ipp: currentIPP, visit_id: currentVisitId, prescription: prescriptionText })
        })
        .then(data => {
             console.log("AI Prescription Analysis Raw Response:", JSON.stringify(data,null,2));
             // Check for success and if a suggestion object exists
             if (data?.success === true && data.suggestion && typeof data.suggestion === 'object') {
                 const d = data.suggestion;
                 console.log("Extracted suggestion:", d);
                 if(aiSuggestionDiv) {
                     // Rebuild the suggestion form content
                     aiSuggestionDiv.innerHTML = `
                         <h3><i class="fas fa-lightbulb"></i> Suggestion Structurée (IA)</h3>
                         <div class="input-group"> <label for="medicament">Médicament:</label> <input type="text" id="medicament"/> </div>
                         <div class="input-group"> <label for="start_date">Date début:</label> <input type="date" id="start_date"/> </div>
                         <div class="input-group"> <label for="end_date">Date fin:</label> <input type="date" id="end_date"/> </div>
                         <div class="input-group">
                            <label>Horaires:</label>
                            <div class="checkbox-wrapper">
                               <label class="checkbox-item"><input type="checkbox" id="matin"/> Matin</label>
                               <label class="checkbox-item"><input type="checkbox" id="apres_midi"/> A-M</label>
                               <label class="checkbox-item"><input type="checkbox" id="soir"/> Soir</label>
                               <label class="checkbox-item"><input type="checkbox" id="nuit"/> Nuit</label>
                            </div>
                         </div>
                         <div class="btn-group">
                            <button type="button" class="btn btn-success" id="validatePrescBtn" onclick="validateAISuggestion()">
                               <i class="fas fa-check-double"></i> Valider & Enregistrer Suggestion
                            </button>
                         </div>`;

                      // Function to convert DD/MM/YYYY from backend to YYYY-MM-DD for input type=date
                     const convertDateToInput = (s) => {
                         try {
                             if (!s || typeof s !== 'string' || !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) return '';
                             const parts = s.split('/'); // [DD, MM, YYYY]
                             const day = parts[0].padStart(2, '0');
                             const month = parts[1].padStart(2, '0');
                             const year = parts[2];
                             return `${year}-${month}-${day}`; // Format YYYY-MM-DD
                         } catch {
                             return ''; // Return empty if conversion fails
                         }
                     };

                     // Populate the fields in the newly created form
                     document.getElementById("medicament").value = d.medicament || '';
                     document.getElementById("start_date").value = convertDateToInput(d.start_date);
                     document.getElementById("end_date").value = convertDateToInput(d.end_date);

                     if(d.schedule && typeof d.schedule === 'object'){
                         document.getElementById("matin").checked = !!d.schedule.matin;
                         document.getElementById("apres_midi").checked = !!d.schedule.apres_midi;
                         document.getElementById("soir").checked = !!d.schedule.soir;
                         document.getElementById("nuit").checked = !!d.schedule.nuit;
                     } else {
                         // Uncheck all if schedule is missing or not an object
                          document.getElementById("matin").checked = false;
                          document.getElementById("apres_midi").checked = false;
                          document.getElementById("soir").checked = false;
                          document.getElementById("nuit").checked = false;
                     }

                     // Scroll suggestion into view
                     aiSuggestionDiv.scrollIntoView({ behavior:'smooth', block: 'nearest' });
                 }
             } else if (data?.success === true && !data.suggestion) {
                  // Handle case where AI ran successfully but found no suggestion
                 console.log("AI ran, but no structured suggestion found.");
                 if(aiSuggestionDiv) {
                      aiSuggestionDiv.innerHTML = `<h3><i class="fas fa-lightbulb"></i> Suggestion Structurée (IA)</h3><p>L'IA n'a pas pu extraire de suggestion structurée de ce texte.</p>`;
                 }
                 // No error message needed in the main validation area
             } else {
                  // Handle explicit failure or unexpected structure
                 throw new Error(data?.message || "Réponse de l'analyse IA invalide ou échec.");
             }
         })
         .catch(e => {
              if(!e.message.startsWith('Auth')) {
                 showMessage(messageEl.id, `<i class='fas fa-exclamation-triangle'></i> Erreur Analyse AI: ${e.message}`, "error");
              }
              console.error("Error submitting prescription to AI:", e);
              // Hide or clear the AI suggestion box on error
              if (aiSuggestionDiv) aiSuggestionDiv.style.display="none";
         })
         .finally(() => {
              if(submitBtn) submitBtn.disabled = false; // Re-enable button
         });
    }

    function validateAISuggestion() {
        const medInput = document.getElementById("medicament");
        const sdInput = document.getElementById("start_date");
        const edInput = document.getElementById("end_date");
        const validateBtn = document.getElementById("validatePrescBtn");
        const messageEl = document.getElementById("validationMessage");

        if (!medInput || !sdInput || !edInput || !validateBtn || !aiSuggestionDiv) {
             console.error("AI Suggestion elements missing for validation.");
             showMessage(messageEl.id, "Erreur interne: Éléments de suggestion manquants.", "error");
             return;
        }

        const med = medInput.value.trim();
        const sd = sdInput.value; // YYYY-MM-DD format from input
        const ed = edInput.value;

        // Basic validation
        if (!med || !sd || !ed) { showMessage(messageEl.id,"Champs Médicament, Date début et Date fin sont requis dans la suggestion.","warning"); return; }
        if (!currentIPP || !currentVisitId) { showMessage(messageEl.id,"Patient/Visite non chargé. Impossible d'enregistrer.","warning"); return; }

        showMessage(messageEl.id, "<i class='fas fa-spinner fa-spin'></i> Enregistrement suggestion...", "loading");
        validateBtn.disabled = true; // Disable button during save

        const schedule = {
            matin: document.getElementById("matin")?.checked ?? false,
            apres_midi: document.getElementById("apres_midi")?.checked ?? false,
            soir: document.getElementById("soir")?.checked ?? false,
            nuit: document.getElementById("nuit")?.checked ?? false
        };

        // Function to convert YYYY-MM-DD from input to MM/DD/YYYY for API (if needed)
        // Or keep YYYY-MM-DD if backend prefers that. Let's assume backend wants MM/DD/YYYY for now based on original code.
        const convertDateToAPI = (dt) => {
            if (!dt || !/^\d{4}-\d{2}-\d{2}$/.test(dt)) return ''; // Validate input format
            const parts = dt.split('-'); // [YYYY, MM, DD]
            return `${parts[1]}/${parts[2]}/${parts[0]}`; // Format MM/DD/YYYY
        };

        const finalPrescText = document.getElementById("prescriptionInput")?.value || ''; // Include original text

        const payload = {
            visit_id: currentVisitId,
            ipp: currentIPP,
            final_prescription: finalPrescText, // Send original text along with structured data
            start_date: convertDateToAPI(sd),
            end_date: convertDateToAPI(ed),
            schedule: schedule,
            medicament_name: med
        };

        console.log("Validating and saving AI suggestion:", payload);

        fetchWithAuth(CONFIG.API_BASE_URL + CONFIG.VALIDATE_PRESCRIPTION_AI_ENDPOINT, {
            method:"POST",
            body: JSON.stringify(payload)
        })
        .then(data =>{
            if(data.success) {
                showMessage(messageEl.id, "<i class='fas fa-check-circle'></i> Suggestion structurée enregistrée.", "success");
                if (aiSuggestionDiv) aiSuggestionDiv.style.display = 'none'; // Hide box on success
            } else {
                throw new Error(data.message || "Échec enregistrement suggestion côté serveur.");
            }
        })
        .catch(e => {
            if(!e.message.startsWith('Auth')) {
               showMessage(messageEl.id, `<i class='fas fa-exclamation-triangle'></i> Erreur Enregistrement Suggestion: ${e.message}`, "error");
            }
            console.error("Error validating/saving AI suggestion:", e);
        })
        .finally(() => {
            validateBtn.disabled = false; // Re-enable button
        });
    }


    // --- INITIALIZATION ---
    function initializeDoctorDashboard() {
        console.log("Initializing Doctor Dashboard...");
        // Check for token BEFORE doing anything else
        if (!localStorage.getItem(CONFIG.TOKEN_KEY)) {
             console.log("Doctor: No token found on init. Redirecting to login.");
             // Redirect immediately, no need to load anything else
             redirectToLogin();
             return; // Stop initialization
        }

        // Token exists, proceed
        currentUserIdentifier = localStorage.getItem(CONFIG.USER_ID_KEY) || 'unknown_doctor';
        console.log("Doctor: Authenticated as", currentUserIdentifier);

        // Make body visible now that basic checks are done
        document.body.classList.add('loaded');

        // Check for IPP in URL parameters
        const urlParams = new URLSearchParams(window.location.search);
        const ippFromUrl = urlParams.get("ipp");

        if (ippFromUrl) {
            console.log(`IPP ${ippFromUrl} found in URL. Loading patient data...`);
            // Load patient directly (this handles UI clearing/enabling internally)
            loadPatientIntoCurrentDashboard(ippFromUrl);
        } else {
            console.log("No IPP found in URL. Dashboard ready for QR scan.");
             // Ensure UI is in the initial 'ready to scan' state
            clearDoctorUI();
        }

        console.log("Doctor Dashboard Initialized.");

        // Setup session timeout listener and activity resetters
        resetSessionTimeout();
        ['mousemove', 'keypress', 'click', 'scroll'].forEach(event => {
            document.addEventListener(event, resetSessionTimeout, { passive: true });
        });
    } // <-- *** THIS IS THE CORRECTED CLOSING BRACE ***

    // --- Start the application ---
    document.addEventListener('DOMContentLoaded', initializeDoctorDashboard);
