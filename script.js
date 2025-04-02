const BASE_URL = 'https://workflows.aphelionxinnovations.com';
const TOKEN = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJndWlkIjoiZmJmMmI1ZjctZTc3ZS00ZGZmLWJlN2UtN2ZlOGVkZmViZmY1IiwiZmlyc3ROYW1lIjoiTW91c3NhIiwibGFzdE5hbWUiOiJTYWlkaSIsInVzZXJuYW1lIjoic2FpZGkiLCJlbWFpbCI6Im1vdXNzYS5zYWlkaS4wMUBnbXppbC5jb20iLCJwYXNzd29yZCI6ImFkbWluMTIzNCIsInJvbGUiOiJBZG1pbiIsImlhdCI6MTc0Mjk1MjMyNn0.1s_IWO-h-AKwkP0LIX8mcjdeLRwsRtgbqAchIJSRVEA'; // replace with your full token

let currentIPP = null;
let aiData = {};
let mediaRecorder;
let audioChunks = [];
let currentField = null;

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
  currentField = field;
  audioChunks = [];

  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.start();

    mediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(audioChunks, { type: 'audio/wav' });
      sendAudioToAI(blob, field);
    };
  }).catch(err => {
    alert("Erreur micro: " + err.message);
  });
}

function stopRecording(field) {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
  }
}

function sendAudioToAI(blob, field) {
  const endpoint = field === 'diagnosis'
    ? `${BASE_URL}/webhook/transcribe-diagnosis`
    : `${BASE_URL}/webhook/transcribe-prescription`;

  const formData = new FormData();
  formData.append("audio", blob, `${field}.wav`);

  fetch(endpoint, {
    method: "POST",
    headers: { Authorization: TOKEN },
    body: formData
  })
    .then(res => res.json())
    .then(data => {
      const text = data.transcribedText || "";
      if (field === 'diagnosis') {
        document.getElementById("diagnosticInput").value = text;
      } else {
        document.getElementById("prescriptionInput").value = text;
      }
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
    .then(() => {
      document.getElementById("diagMessage").innerText = "✅ Diagnostic enregistré.";
    });
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
        <p><strong>💡 IA Suggestion:</strong> ${aiData.medicament} du ${aiData.start_date} au ${aiData.end_date} à ${Object.entries(aiData.schedule).filter(([_, v]) => v).map(([k]) => k).join(', ')}</p>
      `;
    });
}
