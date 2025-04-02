const BASE_URL = 'https://workflows.aphelionxinnovations.com';
const TOKEN = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJndWlkIjoiZmJmMmI1ZjctZTc3ZS00ZGZmLWJlN2UtN2ZlOGVkZmViZmY1IiwiZmlyc3ROYW1lIjoiTW91c3NhIiwibGFzdE5hbWUiOiJTYWlkaSIsInVzZXJuYW1lIjoic2FpZGkiLCJlbWFpbCI6Im1vdXNzYS5zYWlkaS4wMUBnbXppbC5jb20iLCJwYXNzd29yZCI6ImFkbWluMTIzNCIsInJvbGUiOiJBZG1pbiIsImlhdCI6MTc0Mjk1MjMyNn0.1s_IWO-h-AKwkP0LIX8mcjdeLRwsRtgbqAchIJSRVEA';

let currentIPP = null;
let aiData = {};
let audioBlob = null;

window.onload = () => {
  const urlParams = new URLSearchParams(window.location.search);
  currentIPP = urlParams.get('ipp');
  if (currentIPP) loadPatient(currentIPP);
};

// Load patient data
function loadPatient(ipp) {
  fetch(`${BASE_URL}/webhook/doctor-get-patient?ipp=${ipp}`, {
    headers: { Authorization: TOKEN }
  })
    .then(res => res.json())
    .then(data => {
      document.getElementById("patientInfo").innerHTML = `
        <h3>👤 ${data.prenom} ${data.nom}</h3>
        <p><strong>IPP:</strong> ${data.ipp}</p>
        <p><strong>CIN:</strong> ${data.cin}</p>
        <p><strong>Téléphone:</strong> ${data.telephone}</p>
        <p><strong>Adresse:</strong> ${data.adresse}</p>
        <p><strong>Mutuelle:</strong> ${data.mutuelle || 'Aucune'}</p>`;
    })
    .catch(err => console.error("Erreur chargement patient:", err));
}

// Start/Stop recording audio
let mediaRecorder;
let audioChunks = [];
document.getElementById('recordAudioButton').addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
  } else {
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then((stream) => {
        mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.ondataavailable = (event) => {
          audioChunks.push(event.data);
        };
        mediaRecorder.onstop = () => {
          audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
          audioChunks = [];
          console.log("Audio recording stopped and stored.");
        };
        mediaRecorder.start();
      })
      .catch((error) => console.error('Audio recording failed:', error));
  }
});

// Send audio to AI for transcription
function submitAudioForTranscription() {
  if (!audioBlob) return alert("Veuillez d'abord enregistrer ou télécharger un fichier audio.");

  const formData = new FormData();
  formData.append('audio', audioBlob);

  fetch(`${BASE_URL}/webhook/transcribe-diagnosis`, {
    method: 'POST',
    headers: { 'Authorization': TOKEN },
    body: formData
  })
    .then(response => response.json())
    .then(data => {
      // Fill the corresponding text area with transcribed text
      const transcribedText = data.transcribedText || 'Transcription failed.';
      document.getElementById('diagnosticInput').value = transcribedText; // for diagnostic
      // If you want to use this for prescription, replace the ID
      // document.getElementById('prescriptionInput').value = transcribedText; // for prescription
    })
    .catch((error) => console.error("Erreur transcription:", error));
}

// Submit Diagnostic
function submitDiagnostic() {
  const diagnostic = document.getElementById("diagnosticInput").value.trim();
  if (!diagnostic) return alert("Veuillez entrer un diagnostic.");
  fetch(`${BASE_URL}/webhook/doctor-submit-diagnostic`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: TOKEN },
    body: JSON.stringify({ ipp: currentIPP, diagnostic })
  })
    .then(() => document.getElementById("diagMessage").innerText = '✅ Diagnostic enregistré.')
    .catch((err) => console.error("Erreur enregistrement diagnostic:", err));
}

// Submit Prescription
function submitPrescription() {
  const prescription = document.getElementById("prescriptionInput").value.trim();
  if (!prescription) return alert("Veuillez écrire une prescription.");
  fetch(`${BASE_URL}/webhook/doctor-submit-prescription`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: TOKEN },
    body: JSON.stringify({ ipp: currentIPP, prescription })
  })
    .then(res => res.json())
    .then(data => {
      aiData = data.suggestion;
      document.getElementById("aiSuggestion").style.display = 'block';
      document.getElementById("suggestionInfo").innerHTML = `
        <p><strong>Médicament suggéré:</strong> ${aiData.medicament}</p>
        <p><strong>Du:</strong> ${aiData.start_date} <strong>au</strong> ${aiData.end_date}</p>
        <p><strong>Horaires suggérés:</strong> ${Object.entries(aiData.schedule).filter(([_, v]) => v).map(([k]) => k).join(', ')}</p>
      `;
    })
    .catch(err => console.error("Erreur suggestion IA:", err));
}

// Validate Prescription
function validatePrescription() {
  const medicament = document.getElementById("medicament").value;
  const start_date = document.getElementById("start_date").value;
  const end_date = document.getElementById("end_date").value;
  const schedule = {
    matin: document.getElementById("matin").checked,
    apres_midi: document.getElementById("apres_midi").checked,
    soir: document.getElementById("soir").checked,
    nuit: document.getElementById("nuit").checked,
  };
  fetch(`${BASE_URL}/webhook/doctor-validate-prescription`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: TOKEN },
    body: JSON.stringify({
      ipp: currentIPP,
      final_prescription: document.getElementById("prescriptionInput").value,
      start_date,
      end_date,
      schedule,
      medicament_name: medicament
    })
  })
    .then(() => document.getElementById("validationMessage").innerText = '✅ Prescription enregistrée.')
    .catch((err) => console.error("Erreur validation prescription:", err));
}
