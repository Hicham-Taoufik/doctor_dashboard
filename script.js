// ✅ Constants
const BASE_URL = 'https://workflows.aphelionxinnovations.com';
const TOKEN = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJndWlkIjoiZmJmMmI1ZjctZTc3ZS00ZGZmLWJlN2UtN2ZlOGVkZmViZmY1IiwiZmlyc3ROYW1lIjoiTW91c3NhIiwibGFzdE5hbWUiOiJTYWlkaSIsInVzZXJuYW1lIjoic2FpZGkiLCJlbWFpbCI6Im1vdXNzYS5zYWlkaS4wMUBnbXppbC5jb20iLCJwYXNzd29yZCI6ImFkbWluMTIzNCIsInJvbGUiOiJBZG1pbiIsImlhdCI6MTc0Mjk1MjMyNn0.1s_IWO-h-AKwkP0LIX8mcjdeLRwsRtgbqAchIJSRVEA';

let currentIPP = null;
let aiData = {};
let mediaRecorder;
let audioChunks = [];

// ✅ On load
window.onload = () => {
  const urlParams = new URLSearchParams(window.location.search);
  currentIPP = urlParams.get('ipp');
  if (currentIPP) loadPatient(currentIPP);
};

// ✅ Load patient info
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
    });
}

// ✅ Start recording
function startRecording() {
  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];
    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
    mediaRecorder.start();
    alert('🎤 Enregistrement en cours... Cliquez pour arrêter.');
  });
}

// ✅ Stop + transcribe diagnostic
function stopAndTranscribeDiagnosis() {
  mediaRecorder.stop();
  mediaRecorder.onstop = () => {
    const blob = new Blob(audioChunks, { type: 'audio/webm' });
    const formData = new FormData();
    formData.append('audio', blob, 'diagnostic.webm');

    fetch(`${BASE_URL}/webhook/transcribe-diagnosis`, {
      method: 'POST',
      headers: { Authorization: TOKEN },
      body: formData
    })
      .then(res => res.json())
      .then(data => {
        const transcript = Array.isArray(data) ? data[0].transcript : data.transcript || data.text;
        document.getElementById("diagnosticInput").value = transcript;
      })
      .catch(err => alert("❌ Erreur de transcription"));
  };
}

// ✅ Stop + transcribe prescription
function stopAndTranscribePrescription() {
  mediaRecorder.stop();
  mediaRecorder.onstop = () => {
    const blob = new Blob(audioChunks, { type: 'audio/webm' });
    const formData = new FormData();
    formData.append('audio', blob, 'prescription.webm');

    fetch(`${BASE_URL}/webhook/transcribe-prescription`, {
      method: 'POST',
      headers: { Authorization: TOKEN },
      body: formData
    })
      .then(res => res.json())
      .then(data => {
        const transcript = Array.isArray(data) ? data[0].transcript : data.transcript || data.text;
        document.getElementById("prescriptionInput").value = transcript;
      })
      .catch(err => alert("❌ Erreur de transcription"));
  };
}

// ✅ Submit diagnostic
function submitDiagnostic() {
  const diagnostic = document.getElementById("diagnosticInput").value.trim();
  if (!diagnostic) return alert("Veuillez entrer un diagnostic.");

  fetch(`${BASE_URL}/webhook/doctor-submit-diagnostic`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: TOKEN },
    body: JSON.stringify({ ipp: currentIPP, diagnostic })
  })
    .then(() => document.getElementById("diagMessage").innerText = '✅ Diagnostic enregistré.');
}

// ✅ Submit prescription (to AI)
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
        <p><strong>Médicament:</strong> ${aiData.medicament}</p>
        <p><strong>Du:</strong> ${aiData.start_date} <strong>au</strong> ${aiData.end_date}</p>
        <p><strong>Horaires:</strong> ${Object.entries(aiData.schedule).filter(([_, v]) => v).map(([k]) => k).join(', ')}</p>
      `;
      document.getElementById("medicament").value = aiData.medicament;
      document.getElementById("start_date").value = aiData.start_date;
      document.getElementById("end_date").value = aiData.end_date;
      document.getElementById("matin").checked = aiData.schedule.matin;
      document.getElementById("apres_midi").checked = aiData.schedule.apres_midi;
      document.getElementById("soir").checked = aiData.schedule.soir;
      document.getElementById("nuit").checked = aiData.schedule.nuit;
    });
}

// ✅ Final validation
function validatePrescription() {
  const medicament = document.getElementById("medicament").value;
  const start_date = document.getElementById("start_date").value;
  const end_date = document.getElementById("end_date").value;
  const schedule = {
    matin: document.getElementById("matin").checked,
    apres_midi: document.getElementById("apres_midi").checked,
    soir: document.getElementById("soir").checked,
    nuit: document.getElementById("nuit").checked
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
    .then(() => document.getElementById("validationMessage").innerText = '✅ Prescription enregistrée.');
}
