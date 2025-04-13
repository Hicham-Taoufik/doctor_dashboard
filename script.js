
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
        // GLOBAL_DICTATION_ENDPOINT: "/webhook/process-visit-dictation", // REMOVED
        UPDATE_CONSULTATION_ENDPOINT: "/webhook/doctor/update-consultation",
        SUBMIT_PRESCRIPTION_AI_ENDPOINT: "/webhook/doctor-submit-prescription",
        VALIDATE_PRESCRIPTION_AI_ENDPOINT: "/webhook/doctor-validate-prescription",
        // NOTE: Individual field transcription endpoints are now defined in getFieldConfig
    };

    // --- Globals ---
    let currentIPP = null;
    let currentVisitId = null;
    let currentUserIdentifier = localStorage.getItem(CONFIG.USER_ID_KEY) || 'unknown_doctor';
    let sessionTimeoutId = null; // For session timeout

    // Recording Globals (Only for individual fields now)
    let mediaRecorder; let audioChunks = []; let recordingField = null;

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
                   // Show a generic communication error, potentially using a specific element later
                   // Find a suitable place for general errors if global section is removed
                   const genericMsgEl = document.getElementById('saveConsultationMessage') || document.getElementById('scanResult'); // Fallback message areas
                    if(genericMsgEl) showMessage(genericMsgEl.id, `Erreur de communication: ${error.message}`, 'error');
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
            // REMOVED '#globalDictationCardBody button',
             '#consultationForm textarea, #consultationForm button, #aiSuggestion input, #aiSuggestion button, #consultationForm .btn-group button'
        );
        // Select the card bodies to visually disable them
        const allCardBodies = document.querySelectorAll(
             // REMOVED '#globalDictationCardBody',
             '#diagCardBody, #prescCardBody, #antecCardBody, #traitementCardBody, #exploCardBody, #orientCardBody, #notesCardBody'
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
            // Stop any active field recordings
             if (mediaRecorder?.state === 'recording') stopRecording(recordingField);
            // Reset recording state variables
            recordingField = null; mediaRecorder = null; audioChunks = [];
            // Clear status indicators and messages within the disabled sections
            document.querySelectorAll('.status').forEach(span => span.innerHTML = '');
            document.querySelectorAll('#consultationForm .message').forEach(div => { // REMOVED , #globalRecordMessage
                div.innerHTML = ''; div.style.display = 'none';
            });
            // Show warning if enable=true but no visitId (shouldn't normally happen due to check above)
            // If globalRecordMessage element is removed, log to console instead or use another area
            if (enable && !currentVisitId) console.warn("Erreur: Activation UI sans ID de visite.");
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
                 return fetchDoctorNotes(currentVisitId); // Chain the promise
            })
            .then(() => {
                 // This block runs after patient info is displayed AND fetchDoctorNotes has completed (successfully or not)
                 enableDoctorSections(true); // Enable UI now that all initial data loading is attempted
                 // Show success message in a different area if global message div is removed
                 const msgArea = document.getElementById('saveConsultationMessage') || patientInfoDiv; // Fallback area
                 if(msgArea === patientInfoDiv) { // If fallback, add message below grid
                    const successMsgDiv = document.createElement('div');
                    successMsgDiv.className = 'message message-success';
                    successMsgDiv.style.display = 'block';
                    successMsgDiv.style.gridColumn = '1 / -1'; // Span across grid
                    successMsgDiv.style.marginTop = '10px';
                    successMsgDiv.innerHTML = `<i class="fas fa-check-circle" style="margin-right: 6px;"></i>Patient ${patientInfoDiv.querySelector('.info-value')?.textContent || ''} chargé (Visite ID: ${currentVisitId}).`;
                    patientInfoDiv.insertAdjacentElement('afterend', successMsgDiv);
                    setTimeout(() => successMsgDiv.remove(), CONFIG.MESSAGE_DISPLAY_TIME);
                 } else {
                    showMessage(msgArea.id, `Patient ${patientInfoDiv.querySelector('.info-value')?.textContent || ''} chargé (Visite ID: ${currentVisitId}).`, 'success');
                 }
                 window.scrollTo({ top: 0, behavior: 'smooth' }); // Scroll to top after load
            })
            .catch(err => {
                 console.error("Error loading doctor visit data or fetching notes:", err);
                 // Display error in patient info area as it's the main loading indicator
                 patientInfoDiv.innerHTML = `<div class="message message-error" style="display:block; grid-column: 1 / -1;">❌ Erreur chargement visite: ${err.message}</div>`;
                 clearDoctorUI(); // Reset the UI state on critical loading failure
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
         try {
             const response = await fetchWithAuth(`${CONFIG.API_BASE_URL}${CONFIG.UPDATE_CONSULTATION_ENDPOINT}?visit_id=${visitId}`); // GET is default

             if (response && response.success && response.data && typeof response.data === 'object' && Object.keys(response.data).length > 0) {
                 console.log("Existing doctor notes received:", response.data);
                 populateDoctorFields(response.data);
             } else if (response && response.success && (!response.data || Object.keys(response.data).length === 0)) {
                 console.log("No existing doctor notes found for this visit.");
                 populateDoctorFields({}); // Ensure fields are cleared/empty if no data
             } else {
                 console.warn("Failed to fetch doctor notes or unexpected response structure:", response);
                 populateDoctorFields({});
                 showMessage('saveConsultationMessage', 'Notes médecin non trouvées ou format invalide.', 'warning');
             }
         } catch(error) {
             console.error("Failed to fetch doctor notes:", error);
             // Use a visible area like saveConsultationMessage to show the error
             showMessage('saveConsultationMessage', `Erreur chargement notes: ${error.message}`, 'error');
             populateDoctorFields({}); // Ensure fields are empty on error
             throw error; // Re-throw so loadPatientVisitData knows it failed
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
                    video.setAttribute('playsinline', true);
                    await video.play();
                    updateScanStatus('Caméra prête. Scannez le QR code.', 'info');
                    scanButton.innerHTML = '<i class="fas fa-stop-circle"></i> Arrêter Scan';
                    scanButton.classList.replace('btn-primary','btn-danger');
                    scanning = true;
                    clearTimeout(scanTimeout);
                    scanTimeout = setTimeout(() => {
                        if (scanning) {
                            updateScanStatus('Aucun code QR détecté.', 'warning');
                            stopScanner();
                        }
                    }, 30000);
                    requestAnimationFrame(tick);
                } catch (err) {
                    console.error("Camera/Scan Error:", err);
                    let errMsg = err.message;
                     if (err.name === 'NotAllowedError') { errMsg = "Permission d'accès caméra refusée."; }
                     else if (err.name === 'NotFoundError') { errMsg = "Aucune caméra compatible trouvée."; }
                    updateScanStatus(`Erreur Caméra: ${errMsg}`, 'error');
                    stopScanner();
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
        clearTimeout(scanTimeout);
        scanning = false;
        if (currentStream) {
            currentStream.getTracks().forEach(track => track.stop());
            currentStream = null;
        }
        if(video) video.srcObject = null;
        if(scannerContainer) scannerContainer.style.display = 'none';
        if(scanButton) {
            scanButton.innerHTML = '<i class="fas fa-qrcode"></i> Scanner QR';
            scanButton.classList.replace('btn-danger','btn-primary');
        }
        console.log("QR Scanner stopped.");
    }

    function tick() {
        if (!scanning || !video || video.readyState < video.HAVE_ENOUGH_DATA || !currentStream) {
             if (scanning) requestAnimationFrame(tick);
            return;
        }

        const canvasElement = document.createElement('canvas');
        canvasElement.height = video.videoHeight;
        canvasElement.width = video.videoWidth;
        const canvas = canvasElement.getContext("2d", { willReadFrequently: true });
        canvas.drawImage(video, 0, 0, canvasElement.width, canvasElement.height);

        try {
            const imageData = canvas.getImageData(0, 0, canvasElement.width, canvasElement.height);
            if (typeof jsQR === 'undefined') {
                 console.error("jsQR library not loaded!");
                 updateScanStatus("Erreur: Librairie QR manquante.", "error");
                 stopScanner();
                 return;
            }
            const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "dontInvert" });

            if (code?.data) {
                console.log("QR Code Found:", code.data);
                stopScanner();
                processScannedQrCode(code.data);
            } else {
                requestAnimationFrame(tick);
            }
        } catch (e) {
            console.error("QR processing error:", e);
            requestAnimationFrame(tick);
        }
    }

    function processScannedQrCode(scannedUrl) {
        clearTimeout(scanTimeout);
        updateScanStatus('Code détecté. Traitement...', 'loading');
        try {
            if (!scannedUrl || !scannedUrl.startsWith(CONFIG.QR_TARGET_BASE_URL)) {
                 throw new Error(`Format QR code non reconnu. Attendu: ${CONFIG.QR_TARGET_BASE_URL}...`);
            }
            const url = new URL(scannedUrl);
            const ippFromQr = url.searchParams.get('ipp');

            if (ippFromQr) {
                updateScanStatus(`Patient IPP ${ippFromQr} trouvé. Chargement des données...`, 'success');
                loadPatientIntoCurrentDashboard(ippFromQr);
            } else {
                throw new Error('Paramètre IPP manquant dans le QR code.');
            }
        } catch (e) {
            console.error("QR processing error:", e);
            updateScanStatus(`Erreur traitement QR: ${e.message}`, 'error');
            clearDoctorUI();
        }
    }

    function loadPatientIntoCurrentDashboard(ipp) {
        console.log(`Loading patient ${ipp} into Doctor dashboard`);
        clearDoctorUI(); // Clear previous state first
        currentIPP = ipp;

        try {
            const newUrl = new URL(window.location);
            newUrl.searchParams.set('ipp', ipp);
            window.history.replaceState({}, '', newUrl);
        } catch(e) {
            console.error("History API error:", e);
        }
        setTimeout(() => { updateScanStatus('', ''); }, 3000);
        console.log("Calling loadPatientVisitData for new patient...");
        loadPatientVisitData(ipp);
    }

    // --- AUDIO RECORDING (Individual Fields Only) ---

     function getFieldConfig(field) {
         const map = {
             diagnostic: { inputId: 'diagnosticInput', statusId: 'diagnosisStatus', messageId: 'diagMessage', startBtnId: 'startDiagRecordBtn', stopBtnId: 'stopDiagRecordBtn', apiField: 'diagnostic', apiEndpoint: '/webhook/transcribe-diagnosis' },
             ordonnance_medicale: { inputId: 'prescriptionInput', statusId: 'ordonnance_medicaleStatus', messageId: 'validationMessage', startBtnId: 'startPrescRecordBtn', stopBtnId: 'stopPrescRecordBtn', apiField: 'ordonnance_medicale', apiEndpoint: '/webhook/transcribe-prescription' },
             antecedents: { inputId: 'antecedentsInput', statusId: 'antecedentsStatus', messageId: 'antecedentsMessage', startBtnId: 'startAntecedentsRecordBtn', stopBtnId: 'stopAntecedentsRecordBtn', apiField: 'antecedents', apiEndpoint: '/webhook/transcribe-antecedents' },
             traitement_en_cours: { inputId: 'traitementInput', statusId: 'traitement_en_coursStatus', messageId: 'traitementMessage', startBtnId: 'startTraitementRecordBtn', stopBtnId: 'stopTraitementRecordBtn', apiField: 'traitement_en_cours', apiEndpoint: '/webhook/transcribe-treatment' },
             prescription_exploration: { inputId: 'explorationInput', statusId: 'prescription_explorationStatus', messageId: 'explorationMessage', startBtnId: 'startExplorationRecordBtn', stopBtnId: 'stopExplorationRecordBtn', apiField: 'prescription_exploration', apiEndpoint: '/webhook/transcribe-exploration' },
             orientation: { inputId: 'orientationInput', statusId: 'orientationStatus', messageId: 'orientationMessage', startBtnId: 'startOrientationRecordBtn', stopBtnId: 'stopOrientationRecordBtn', apiField: 'orientation', apiEndpoint: '/webhook/transcribe-orientation' },
             notes_supplementaires: { inputId: 'notesInput', statusId: 'notes_supplementairesStatus', messageId: 'notesMessage', startBtnId: 'startNotesRecordBtn', stopBtnId: 'stopNotesRecordBtn', apiField: 'notes_supplementaires', apiEndpoint: '/webhook/transcribe-notes' }
         };
         return map[field];
     }

     function startRecording(field) {
         const config = getFieldConfig(field);
         if (!config) { console.error(`Invalid field specified for recording: ${field}`); return; }
         if (!currentIPP || !currentVisitId) { alert("Veuillez d'abord scanner un patient et charger sa visite."); return; }
         // REMOVED: Check for isGlobalRecording
         if (mediaRecorder && mediaRecorder.state === 'recording') { alert("Un autre enregistrement est déjà en cours."); return; }

         audioChunks = [];
         recordingField = field;

         const statusEl = document.getElementById(config.statusId);
         const startBtn = document.getElementById(config.startBtnId);
         const stopBtn = document.getElementById(config.stopBtnId);
         const messageEl = document.getElementById(config.messageId);

         if(!statusEl || !startBtn || !stopBtn || !messageEl){ console.error(`UI Elements not found for field recording: ${field}`); return; }

         showMessage(messageEl.id, '', '');
         statusEl.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Démarrage...';
         statusEl.style.display = 'inline-flex';
         startBtn.disabled = true;
         stopBtn.disabled = false;

         navigator.mediaDevices.getUserMedia({ audio: true })
             .then(stream => {
                 mediaRecorder = new MediaRecorder(stream);
                 mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
                 mediaRecorder.onstop = () => handleRecordingStop(stream);
                 mediaRecorder.onerror = e => {
                     console.error(`Recording Error (${recordingField}):`, e.error || e);
                     if(statusEl) statusEl.innerHTML = '<i class="fas fa-times-circle"></i> Err Rec.';
                     showMessage(messageEl.id, `Erreur enregistrement: ${e.error?.message || 'Inconnue'}`, "error");
                     startBtn.disabled = false; stopBtn.disabled = true;
                     recordingField = null; mediaRecorder = null;
                     stream.getTracks().forEach(track => track.stop());
                 };
                 mediaRecorder.start();
                 statusEl.innerHTML = '<i class="fas fa-microphone-alt fa-fade" style="color: var(--danger);"></i> REC...';
                 console.log(`Recording started for field: ${field}`);
             }).catch(err => {
                 console.error("Microphone Access Error:", err);
                 if(statusEl) statusEl.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Err micro';
                 showMessage(messageEl.id, `Accès microphone impossible: ${err.message}`, "error");
                 startBtn.disabled = false; stopBtn.disabled = true;
                 recordingField = null;
             });
     }

     function stopRecording(field) {
         const config = getFieldConfig(field);
         if (!config) { console.warn(`stopRecording called for invalid field: ${field}`); return; }
         const startBtn = document.getElementById(config.startBtnId);
         const stopBtn = document.getElementById(config.stopBtnId);
         const statusEl = document.getElementById(config.statusId);

         if (mediaRecorder && mediaRecorder.state === 'recording' && recordingField === field) {
              console.log(`Stopping recording for field: ${field}`);
              mediaRecorder.stop(); // Triggers onstop
              if(statusEl) statusEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Arrêt...';
         } else {
             console.log(`Stop called for ${field}, but not actively recording it.`);
             if(startBtn) startBtn.disabled = false;
             if(stopBtn) stopBtn.disabled = true;
         }
     }

     function handleRecordingStop(stream) {
         const currentField = recordingField;
         if (!currentField) { console.warn("handleRecordingStop called but no recordingField set."); if(stream) stream.getTracks().forEach(track => track.stop()); return; }
         const config = getFieldConfig(currentField);
         if (!config) { console.error(`Config not found for stopped field: ${currentField}`); if(stream) stream.getTracks().forEach(track => track.stop()); return; }

         console.log(`Recording stopped for ${currentField}. Chunks: ${audioChunks.length}`);
         const statusEl = document.getElementById(config.statusId);
         const messageEl = document.getElementById(config.messageId);
         const startBtn = document.getElementById(config.startBtnId);
         const stopBtn = document.getElementById(config.stopBtnId);

         if (audioChunks.length === 0) {
             if(statusEl) statusEl.innerHTML = '<i class="fas fa-exclamation-circle"></i> Audio vide';
             showMessage(messageEl.id, "Aucun audio n'a été enregistré.", "warning");
             if(startBtn) startBtn.disabled = false; if(stopBtn) stopBtn.disabled = true;
             setTimeout(() => { if (statusEl?.innerHTML.includes('Audio vide')) statusEl.innerHTML = ''; }, 4000);
         } else {
             const blob = new Blob(audioChunks, { type: 'audio/webm' });
             audioChunks = [];
             if(statusEl) statusEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Transcription...';
             showMessage(messageEl.id, "Envoi pour transcription...", "loading");
             sendAudioToAI(blob, currentField); // Handles button reset in finally
         }

         recordingField = null; mediaRecorder = null;
         if (stream) { stream.getTracks().forEach(track => track.stop()); console.log("Microphone stream stopped."); }
     }

     function sendAudioToAI(blob, field) {
         const config = getFieldConfig(field);
         if (!config || !config.apiEndpoint) {
             console.error(`Config/Endpoint missing for field: ${field}`);
             const msgId = config?.messageId || 'saveConsultationMessage'; // Use saveConsultationMessage as fallback if global is removed
             showMessage(msgId, `Erreur Config: Endpoint manquant pour '${field}'.`, "error");
             const startBtn = document.getElementById(config?.startBtnId); const stopBtn = document.getElementById(config?.stopBtnId);
             if(startBtn) startBtn.disabled = false; if(stopBtn) stopBtn.disabled = true;
             return;
         }
         if (!currentIPP || !currentVisitId) {
             showMessage(config.messageId, "IPP/Visite ID manquant pour l'envoi.", "error");
             const startBtn = document.getElementById(config.startBtnId); const stopBtn = document.getElementById(config.stopBtnId);
             if(startBtn) startBtn.disabled = false; if(stopBtn) stopBtn.disabled = true;
             return;
         }

         const formData = new FormData();
         formData.append("audio", blob, `${field}_${currentIPP}_${Date.now()}.webm`);
         formData.append("ipp", currentIPP);
         formData.append("visit_id", currentVisitId);

         const statusEl = document.getElementById(config.statusId);
         const messageEl = document.getElementById(config.messageId);
         const targetTextarea = document.getElementById(config.inputId);
         const startBtn = document.getElementById(config.startBtnId);
         const stopBtn = document.getElementById(config.stopBtnId);

         if(statusEl) statusEl.innerHTML = '<i class="fas fa-paper-plane"></i> Envoi...';
         const fullUrl = CONFIG.API_BASE_URL + config.apiEndpoint;
         console.log(`Sending audio for field '${field}' to endpoint: ${fullUrl}`);

         fetchWithAuth(fullUrl, { method: "POST", body: formData })
             .then(data => {
                 console.log(`Transcription response for ${field} from ${config.apiEndpoint}:`, data);
                 let transcript = '';
                 if (data?.success === true && typeof data.transcript === 'string') { transcript = data.transcript; }
                 else if (data?.success === false) { throw new Error(data.message || `Échec transcription pour ${field}`); }
                 else { throw new Error(`Réponse transcription invalide pour ${field}.`); }

                 if (transcript === null || transcript === undefined) {
                      console.warn("Transcription vide (null/undefined) reçue:", data);
                      if(statusEl) statusEl.innerHTML = '<i class="fas fa-exclamation-circle"></i> Vide';
                      showMessage(messageEl.id, "Transcription vide reçue.", "warning");
                      if(targetTextarea) targetTextarea.value = '';
                 } else {
                     if(targetTextarea) targetTextarea.value = transcript;
                     if(statusEl) statusEl.innerHTML = '<i class="fas fa-check"></i> OK';
                     showMessage(messageEl.id, '', '');
                 }
             })
             .catch(e => {
                 if (!e.message.startsWith('Auth')){
                     if(statusEl) statusEl.innerHTML = '<i class="fas fa-times-circle"></i> Erreur';
                     showMessage(messageEl.id, `Erreur Transc.: ${e.message}`, "error");
                 }
                 console.error(`Transcription error for ${field} using ${config.apiEndpoint}:`, e);
             })
             .finally(() => {
                 if(startBtn) startBtn.disabled = false; if(stopBtn) stopBtn.disabled = true;
                 setTimeout(() => {
                     const currentStatusHTML = statusEl?.innerHTML;
                     if (currentStatusHTML && (currentStatusHTML.includes('OK') || currentStatusHTML.includes('Erreur') || currentStatusHTML.includes('Vide'))) {
                          statusEl.innerHTML = '';
                     }
                 }, 4000);
             });
     }

    // --- GLOBAL DICTATION FUNCTIONS REMOVED ---
    // startGlobalRecording, stopGlobalRecording, handleGlobalRecordingStop, sendGlobalAudioToBackend ARE GONE

    // --- SAVING CONSULTATION DATA ---
    function saveIndividualField(fieldName, inputElementId, messageElementId, buttonElementId) {
        const inputElement = document.getElementById(inputElementId);
        const saveButton = document.getElementById(buttonElementId);
        if (!currentVisitId) { showMessage(messageElementId, "ID Visite manquant pour sauvegarde.", "error"); return; }
        if (!inputElement) { console.error(`Input element ${inputElementId} not found for saving.`); showMessage(messageElementId, "Erreur interne: Champ introuvable.", "error"); return; }
        if (!saveButton) { console.warn(`Save button ${buttonElementId} not found.`); }

        const textValue = inputElement.value;
        const payload = { visit_id: currentVisitId, doctor_identifier: currentUserIdentifier, [fieldName]: textValue };

        showMessage(messageElementId, '<i class="fas fa-spinner fa-spin"></i> Enregistrement...', 'loading');
        if(saveButton) saveButton.disabled = true;

        fetchWithAuth(CONFIG.API_BASE_URL + CONFIG.UPDATE_CONSULTATION_ENDPOINT, { method: 'POST', body: JSON.stringify(payload) })
        .then(data => {
            if (data.success) { showMessage(messageElementId, `<i class="fas fa-check-circle"></i> ${data.message || 'Enregistré.'}`, 'success'); }
            else { throw new Error(data.message || "Échec de la sauvegarde côté serveur."); }
        })
        .catch(e => {
            if (!e.message.startsWith('Auth')) { showMessage(messageElementId, `<i class="fas fa-times-circle"></i> Erreur sauvegarde: ${e.message}`, 'error'); }
            console.error(`Error saving field ${fieldName}:`, e);
        })
        .finally(() => { if(saveButton) saveButton.disabled = false; });
    }

    // Save All Function (triggered by form submit)
    function saveAllConsultationData() {
        if (!currentVisitId) { showMessage('saveConsultationMessage', "Contexte visite manquant pour sauvegarde complète.", "error"); return; }
        if (!consultationForm) { console.error("Consultation form not found!"); showMessage('saveConsultationMessage', "Erreur interne: Formulaire introuvable.", "error"); return; }

        const saveButton = document.getElementById('saveAllConsultationBtn');
        showMessage('saveConsultationMessage', '<i class="fas fa-spinner fa-spin"></i> Enregistrement complet en cours...', 'loading');
        if(saveButton) saveButton.disabled = true;

        const formData = new FormData(consultationForm);
        const payload = { visit_id: currentVisitId, doctor_identifier: currentUserIdentifier };
        for (const [key, value] of formData.entries()) { payload[key] = value.trim() === '' ? null : value.trim(); }
        console.log("Saving all consultation data:", payload);

        fetchWithAuth(CONFIG.API_BASE_URL + CONFIG.UPDATE_CONSULTATION_ENDPOINT, { method: 'POST', body: JSON.stringify(payload) })
        .then(data => {
            if (data.success) { showMessage('saveConsultationMessage', `<i class="fas fa-check-circle"></i> ${data.message || 'Consultation complète enregistrée.'}`, 'success'); }
            else { throw new Error(data.message || "Échec de la sauvegarde complète côté serveur."); }
        })
        .catch(e => {
            if (!e.message.startsWith('Auth')) { showMessage('saveConsultationMessage', `<i class="fas fa-times-circle"></i> Erreur sauvegarde complète: ${e.message}`, 'error'); }
            console.error(`Error saving all consultation data:`, e);
        })
        .finally(() => { if(saveButton) saveButton.disabled = false; });
    }


    // --- PRESCRIPTION AI ---
    function submitPrescriptionToAI() {
        const prescInput = document.getElementById("prescriptionInput");
        const submitBtn = document.getElementById("submitPrescBtn");
        const messageEl = document.getElementById("validationMessage");
        if (!prescInput) { console.error("Prescription input not found."); return; }
        if (!submitBtn) { console.warn("Submit prescription button not found."); }

        const prescriptionText = prescInput.value.trim();
        if (!prescriptionText) { showMessage(messageEl.id, `Veuillez saisir ou dicter une prescription.`, "warning"); return; }
        if (!currentIPP || !currentVisitId) { showMessage(messageEl.id, `Patient/Visite non chargé. Impossible d'analyser.`, "warning"); return; }

        showMessage(messageEl.id, "", "");
        if (aiSuggestionDiv) {
            aiSuggestionDiv.style.display = "block";
            aiSuggestionDiv.innerHTML = `<h3><i class="fas fa-lightbulb"></i> Suggestion Structurée (IA)</h3><div class="message message-loading" style="display:block;"><i class="fas fa-spinner fa-spin"></i> Analyse IA de la prescription en cours...</div>`;
        }
        if(submitBtn) submitBtn.disabled = true;

        fetchWithAuth(CONFIG.API_BASE_URL + CONFIG.SUBMIT_PRESCRIPTION_AI_ENDPOINT, { method: "POST", body: JSON.stringify({ ipp: currentIPP, visit_id: currentVisitId, prescription: prescriptionText }) })
        .then(data => {
             console.log("AI Prescription Analysis Raw Response:", JSON.stringify(data,null,2));
             if (data?.success === true && data.suggestion && typeof data.suggestion === 'object') {
                 const d = data.suggestion;
                 console.log("Extracted suggestion:", d);
                 if(aiSuggestionDiv) {
                     aiSuggestionDiv.innerHTML = `
                         <h3><i class="fas fa-lightbulb"></i> Suggestion Structurée (IA)</h3>
                         <div class="input-group"> <label for="medicament">Médicament:</label> <input type="text" id="medicament"/> </div>
                         <div class="input-group"> <label for="start_date">Date début:</label> <input type="date" id="start_date"/> </div>
                         <div class="input-group"> <label for="end_date">Date fin:</label> <input type="date" id="end_date"/> </div>
                         <div class="input-group"> <label>Horaires:</label> <div class="checkbox-wrapper"> <label class="checkbox-item"><input type="checkbox" id="matin"/> Matin</label> <label class="checkbox-item"><input type="checkbox" id="apres_midi"/> A-M</label> <label class="checkbox-item"><input type="checkbox" id="soir"/> Soir</label> <label class="checkbox-item"><input type="checkbox" id="nuit"/> Nuit</label> </div> </div>
                         <div class="btn-group"> <button type="button" class="btn btn-success" id="validatePrescBtn" onclick="validateAISuggestion()"> <i class="fas fa-check-double"></i> Valider & Enregistrer Suggestion </button> </div>`;
                     const convertDateToInput = (s) => { try { if (!s || typeof s !== 'string' || !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) return ''; const p=s.split('/'); return `${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`; } catch { return ''; } };
                     document.getElementById("medicament").value = d.medicament || '';
                     document.getElementById("start_date").value = convertDateToInput(d.start_date);
                     document.getElementById("end_date").value = convertDateToInput(d.end_date);
                     if(d.schedule && typeof d.schedule === 'object'){ document.getElementById("matin").checked = !!d.schedule.matin; document.getElementById("apres_midi").checked = !!d.schedule.apres_midi; document.getElementById("soir").checked = !!d.schedule.soir; document.getElementById("nuit").checked = !!d.schedule.nuit; }
                     else { document.getElementById("matin").checked = false; document.getElementById("apres_midi").checked = false; document.getElementById("soir").checked = false; document.getElementById("nuit").checked = false; }
                     aiSuggestionDiv.scrollIntoView({ behavior:'smooth', block: 'nearest' });
                 }
             } else if (data?.success === true && !data.suggestion) {
                 console.log("AI ran, but no structured suggestion found.");
                 if(aiSuggestionDiv) { aiSuggestionDiv.innerHTML = `<h3><i class="fas fa-lightbulb"></i> Suggestion Structurée (IA)</h3><p>L'IA n'a pas pu extraire de suggestion structurée de ce texte.</p>`; }
             } else {
                 throw new Error(data?.message || "Réponse de l'analyse IA invalide ou échec.");
             }
         })
         .catch(e => {
              if(!e.message.startsWith('Auth')) { showMessage(messageEl.id, `<i class='fas fa-exclamation-triangle'></i> Erreur Analyse AI: ${e.message}`, "error"); }
              console.error("Error submitting prescription to AI:", e);
              if (aiSuggestionDiv) aiSuggestionDiv.style.display="none";
         })
         .finally(() => { if(submitBtn) submitBtn.disabled = false; });
    }

    function validateAISuggestion() {
        const medInput = document.getElementById("medicament");
        const sdInput = document.getElementById("start_date");
        const edInput = document.getElementById("end_date");
        const validateBtn = document.getElementById("validatePrescBtn");
        const messageEl = document.getElementById("validationMessage");
        if (!medInput || !sdInput || !edInput || !validateBtn || !aiSuggestionDiv) { console.error("AI Suggestion elements missing for validation."); showMessage(messageEl.id, "Erreur interne: Éléments de suggestion manquants.", "error"); return; }
        const med = medInput.value.trim(); const sd = sdInput.value; const ed = edInput.value;
        if (!med || !sd || !ed) { showMessage(messageEl.id,"Champs Médicament, Date début et Date fin sont requis dans la suggestion.","warning"); return; }
        if (!currentIPP || !currentVisitId) { showMessage(messageEl.id,"Patient/Visite non chargé. Impossible d'enregistrer.","warning"); return; }

        showMessage(messageEl.id, "<i class='fas fa-spinner fa-spin'></i> Enregistrement suggestion...", "loading");
        validateBtn.disabled = true;
        const schedule = { matin: document.getElementById("matin")?.checked ?? false, apres_midi: document.getElementById("apres_midi")?.checked ?? false, soir: document.getElementById("soir")?.checked ?? false, nuit: document.getElementById("nuit")?.checked ?? false };
        const convertDateToAPI = (dt) => { if (!dt || !/^\d{4}-\d{2}-\d{2}$/.test(dt)) return ''; const p = dt.split('-'); return `${p[1]}/${p[2]}/${p[0]}`; };
        const finalPrescText = document.getElementById("prescriptionInput")?.value || '';
        const payload = { visit_id: currentVisitId, ipp: currentIPP, final_prescription: finalPrescText, start_date: convertDateToAPI(sd), end_date: convertDateToAPI(ed), schedule: schedule, medicament_name: med };
        console.log("Validating and saving AI suggestion:", payload);

        fetchWithAuth(CONFIG.API_BASE_URL + CONFIG.VALIDATE_PRESCRIPTION_AI_ENDPOINT, { method:"POST", body: JSON.stringify(payload) })
        .then(data =>{
            if(data.success) { showMessage(messageEl.id, "<i class='fas fa-check-circle'></i> Suggestion structurée enregistrée.", "success"); if (aiSuggestionDiv) aiSuggestionDiv.style.display = 'none'; }
            else { throw new Error(data.message || "Échec enregistrement suggestion côté serveur."); }
        })
        .catch(e => {
            if(!e.message.startsWith('Auth')) { showMessage(messageEl.id, `<i class='fas fa-exclamation-triangle'></i> Erreur Enregistrement Suggestion: ${e.message}`, "error"); }
            console.error("Error validating/saving AI suggestion:", e);
        })
        .finally(() => { validateBtn.disabled = false; });
    }


    // --- INITIALIZATION ---
    function initializeDoctorDashboard() {
        console.log("Initializing Doctor Dashboard...");
        if (!localStorage.getItem(CONFIG.TOKEN_KEY)) {
             console.log("Doctor: No token found on init. Redirecting to login.");
             redirectToLogin();
             return;
        }

        currentUserIdentifier = localStorage.getItem(CONFIG.USER_ID_KEY) || 'unknown_doctor';
        console.log("Doctor: Authenticated as", currentUserIdentifier);
        document.body.classList.add('loaded');

        const urlParams = new URLSearchParams(window.location.search);
        const ippFromUrl = urlParams.get("ipp");

        if (ippFromUrl) {
            console.log(`IPP ${ippFromUrl} found in URL. Loading patient data...`);
            loadPatientIntoCurrentDashboard(ippFromUrl);
        } else {
            console.log("No IPP found in URL. Dashboard ready for QR scan.");
            clearDoctorUI();
        }

        console.log("Doctor Dashboard Initialized.");
        resetSessionTimeout();
        ['mousemove', 'keypress', 'click', 'scroll'].forEach(event => {
            document.addEventListener(event, resetSessionTimeout, { passive: true });
        });
    }

    // --- Start the application ---
    document.addEventListener('DOMContentLoaded', initializeDoctorDashboard);
