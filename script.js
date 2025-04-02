const BASE_URL = 'https://workflows.aphelionxinnovations.com';
const TOKEN = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJndWlkIjoiZmJmMmI1ZjctZTc3ZS00ZGZmLWJlN2UtN2ZlOGVkZmViZmY1IiwiZmlyc3ROYW1lIjoiTW91c3NhIiwibGFzdE5hbWUiOiJTYWlkaSIsInVzZXJuYW1lIjoic2FpZGkiLCJlbWFpbCI6Im1vdXNzYS5zYWlkaS4wMUBnbXppbC5jb20iLCJwYXNzd29yZCI6ImFkbWluMTIzNCIsInJvbGUiOiJBZG1pbiIsImlhdCI6MTc0Mjk1MjMyNn0.1s_IWO-h-AKwkP0LIX8mcjdeLRwsRtgbqAchIJSRVEA'; // Replace with your real token
let currentIPP = null;
let aiData = {};

window.onload = () => {
  const urlParams = new URLSearchParams(window.location.search);
  currentIPP = urlParams.get('ipp');
  if (currentIPP) {
    loadPatient(currentIPP);
    loadHistory(currentIPP);
  }
};

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

function loadHistory(ipp) {
  fetch(`${BASE_URL}/webhook/patient-history?ipp=${ipp}`, {
    headers: { Authorization: TOKEN }
  })
    .then(res => res.json())
    .then(data => {
      let html = '';
      (data.diagnostics || []).forEach(d => {
        html += `<p><strong>🩻</strong> ${d.diagnostic} - ${new Date(d.date_consultation).toLocaleDateString()}</p>`;
      });
      (data.prescriptions || []).forEach(p => {
        html += `<p><strong>💊</strong> ${p.prescription_text} (${p.start_date} → ${p.end_date})</p>`;
      });
      document.getElementById("patientHistory").innerHTML = html || 'Aucun historique.';
    });
}

function submitDiagnostic() {
  const diagnostic = document.getElementById("diagnosticInput").value;
  fetch(`${BASE_URL}/webhook/doctor-submit-diagnostic`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: TOKEN
    },
    body: JSON.stringify({ ipp: currentIPP, diagnostic })
  })
    .then(res => res.json())
    .then(() => {
      document.getElementById("diagMessage").innerText = '✅ Diagnostic enregistré.';
      loadHistory(currentIPP);
    });
}

function submitPrescription() {
  const prescription = document.getElementById("prescriptionInput").value;
  fetch(`${BASE_URL}/webhook/doctor-submit-prescription`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: TOKEN
    },
    body: JSON.stringify({ ipp: currentIPP, prescription })
  })
    .then(res => res.json())
    .then(data => {
      aiData = data.suggestion;
      document.getElementById("aiSuggestion").innerHTML = `
        <h4>🧠 Suggestion IA</h4>
        <p><strong>Médicament:</strong> ${aiData.medicament}</p>
        <p><strong>Du:</strong> ${aiData.start_date} <strong>au</strong> ${aiData.end_date}</p>
        <p><strong>Horaires:</strong> ${['matin', 'apres_midi', 'soir', 'nuit'].filter(p => aiData.schedule[p]).join(', ')}</p>
      `;
    });
}

function validatePrescription() {
  fetch(`${BASE_URL}/webhook/doctor-validate-prescription`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: TOKEN
    },
    body: JSON.stringify({
      ipp: currentIPP,
      final_prescription: document.getElementById("prescriptionInput").value,
      start_date: aiData.start_date,
      end_date: aiData.end_date,
      schedule: aiData.schedule,
      medicament_name: aiData.medicament
    })
  })
    .then(res => res.json())
    .then(() => {
      document.getElementById("validationMessage").innerText = '✅ Prescription enregistrée.';
      loadHistory(currentIPP);
    });
}
