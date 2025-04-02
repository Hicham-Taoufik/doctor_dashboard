// ✅ Constants
const BASE_URL = 'https://workflows.aphelionxinnovations.com';
const TOKEN = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJndWlkIjoiZmJmMmI1ZjctZTc3ZS00ZGZmLWJlN2UtN2ZlOGVkZmViZmY1IiwiZmlyc3ROYW1lIjoiTW91c3NhIiwibGFzdE5hbWUiOiJTYWlkaSIsInVzZXJuYW1lIjoic2FpZGkiLCJlbWFpbCI6Im1vdXNzYS5zYWlkaS4wMUBnbXppbC5jb20iLCJwYXNzd29yZCI6ImFkbWluMTIzNCIsInJvbGUiOiJBZG1pbiIsImlhdCI6MTc0Mjk1MjMyNn0.1s_IWO-h-AKwkP0LIX8mcjdeLRwsRtgbqAchIJSRVEA';

let currentIPP = null;
let aiData = {};
let mediaRecorder;
let audioChunks = [];

window.onload = () => {
  const urlParams = new URLSearchParams(window.location.search);
  currentIPP = urlParams.get('ipp');
  if (currentIPP) loadPatient(currentIPP);
};

function loadPatient(ipp) {
  fetch(`${BASE_URL}/webhook/doctor-get-patient?ipp=${ipp}`, {
    headers: { Authorization: TOKEN }
  })
    .then(res => res.json())
    .then(data => {
      document.getElementById("patientInfo").innerHTML = `
        <strong>Nom:</strong> ${data.prenom} ${data.nom}<br>
        <strong>IPP:</strong> ${data.ipp}<br>
        <strong>CIN:</strong> ${data.cin}<br>
        <strong>Téléphone:</strong> ${data.telephone}<br>
        <strong>Adresse:</strong> ${data.adresse}<br>
        <strong>Mutuelle:</strong> ${data.mutuelle || 'Aucune'}
      `;
    });
}

function startRecording(field) {
  audioChunks = [];
  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.start();
    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
    document.getElementById(`${field}Status`).innerText = '🎙️ Enregistrement...';
  });
}

function stopRecording(field) {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    mediaRecorder.onstop = () => {
      const blob = new Blob(audioChunks, { type: 'audio/webm' });
      sendAudioToAI(blob, field);
      document.getElementById(`${field}Status`).innerText = '⏳ Transcription...';
    };
  }
}

function sendAudioToAI(blob, field) {
  const endpoint = field === 'diagnosis' ? `${BASE_URL}/webhook/transcribe-diagnosis` : `${BASE_URL}/webhook/transcribe-prescription`;
  const formData = new FormData();
  formData.append("audio", blob, `${field}.webm`);

  fetch(endpoint, {
    method: "POST",
    headers: { Authorization: TOKEN },
    body: formData
  })
    .then(res => res.json())
    .then(data => {
      const text = Array.isArray(data) ? data[0]?.text || data[0]?.transcript : data?.text || data?.transcript;
      if (!text) {
        document.getElementById(`${field}Status`).innerText = "⚠️ Transcription vide.";
        return;
      }
      if (field === 'diagnosis') {
        document.getElementById("diagnosticInput").value = text;
      } else {
        document.getElementById("prescriptionInput").value = text;
      }
      document.getElementById(`${field}Status`).innerText = "✅ Transcription terminée.";
    })
    .catch(err => {
      console.error("Erreur transcription:", err);
      document.getElementById(`${field}Status`).innerText = "❌ Erreur de transcription.";
    });
}

function submitDiagnostic() {
  const diag = document.getElementById("diagnosticInput").value;
  if (!diag) return alert("Entrez un diagnostic");
  fetch(`${BASE_URL}/webhook/doctor-submit-diagnostic`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: TOKEN },
    body: JSON.stringify({ ipp: currentIPP, diagnostic: diag })
  })
    .then(() => document.getElementById("diagMessage").innerText = "✅ Diagnostic enregistré.");
}

function submitPrescription() {
  const prescription = document.getElementById("prescriptionInput").value;
  if (!prescription) return alert("Entrez une prescription");
  fetch(`${BASE_URL}/webhook/doctor-submit-prescription`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: TOKEN },
    body: JSON.stringify({ ipp: currentIPP, prescription })
  })
    .then(res => res.json())
    .then(data => {
      aiData = data.suggestion;
      document.getElementById("aiSuggestion").innerHTML = `
        <h3>💡 Suggestion IA</h3>
        <label>Médicament:</label>
        <input id="medicament" value="${aiData.medicament}" />

        <label>Date de début:</label>
        <input type="date" id="start_date" value="${aiData.start_date}" />

        <label>Date de fin:</label>
        <input type="date" id="end_date" value="${aiData.end_date}" />

        <label>Horaires :</label><br/>
        <label><input type="checkbox" id="matin" ${aiData.schedule.matin ? 'checked' : ''}/> Matin</label>
        <label><input type="checkbox" id="apres_midi" ${aiData.schedule.apres_midi ? 'checked' : ''}/> Après-midi</label>
        <label><input type="checkbox" id="soir" ${aiData.schedule.soir ? 'checked' : ''}/> Soir</label>
        <label><input type="checkbox" id="nuit" ${aiData.schedule.nuit ? 'checked' : ''}/> Nuit</label>

        <br><br>
        <button onclick="validatePrescription()">✅ Valider la prescription</button>
        <p id="validationMessage"></p>
      `;
    });
}

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
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: TOKEN },
    body: JSON.stringify({
      ipp: currentIPP,
      final_prescription: document.getElementById("prescriptionInput").value,
      start_date,
      end_date,
      schedule,
      medicament_name: medicament
    })
  })
    .then(() => document.getElementById("validationMessage").innerText = "✅ Prescription enregistrée.");
}
