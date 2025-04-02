const BASE_URL = 'https://workflows.aphelionxinnovations.com';
const TOKEN = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJndWlkIjoiZmJmMmI1ZjctZTc3ZS00ZGZmLWJlN2UtN2ZlOGVkZmViZmY1IiwiZmlyc3ROYW1lIjoiTW91c3NhIiwibGFzdE5hbWUiOiJTYWlkaSIsInVzZXJuYW1lIjoic2FpZGkiLCJlbWFpbCI6Im1vdXNzYS5zYWlkaS4wMUBnbXppbC5jb20iLCJwYXNzd29yZCI6ImFkbWluMTIzNCIsInJvbGUiOiJBZG1pbiIsImlhdCI6MTc0Mjk1MjMyNn0.1s_IWO-h-AKwkP0LIX8mcjdeLRwsRtgbqAchIJSRVEA'; // Use your real token

let currentIPP = null;
let aiData = {};

window.onload = () => {
  const urlParams = new URLSearchParams(window.location.search);
  currentIPP = urlParams.get('ipp');
  console.log('Extracted IPP:', currentIPP); // ✅ Debug IPP from URL

  if (currentIPP) {
    loadPatient(currentIPP);
  } else {
    console.error('IPP not found in URL.');
  }
};

function loadPatient(ipp) {
  fetch(`${BASE_URL}/webhook/doctor-get-patient?ipp=${ipp}`, {
    headers: { Authorization: TOKEN }
  })
    .then(res => res.json())
    .then(data => {
      if (!data || !data.nom) {
        console.error('Invalid data received:', data);
        return;
      }
      document.getElementById("patientInfo").innerHTML = `
        <h3>👤 ${data.prenom} ${data.nom}</h3>
        <p><strong>IPP:</strong> ${data.ipp}</p>
        <p><strong>CIN:</strong> ${data.cin}</p>
        <p><strong>Téléphone:</strong> ${data.telephone}</p>
        <p><strong>Adresse:</strong> ${data.adresse}</p>
        <p><strong>Mutuelle:</strong> ${data.mutuelle || 'Aucune'}</p>`;
    })
    .catch(err => console.error("Erreur lors du chargement du patient:", err));
}

function submitDiagnostic() {
  const diagnostic = document.getElementById("diagnosticInput").value.trim();
  if (!diagnostic) {
    document.getElementById("diagMessage").innerText = "❗ Veuillez écrire un diagnostic.";
    return;
  }

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
    })
    .catch(err => console.error("Erreur lors de l'enregistrement du diagnostic:", err));
}

function submitPrescription() {
  const prescription = document.getElementById("prescriptionInput").value.trim();
  if (!prescription) {
    alert("Veuillez écrire une prescription avant de la soumettre à l'IA.");
    return;
  }

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

      const renderCheckbox = (id, label) => `
        <label style="margin-right: 10px;">
          <input type="checkbox" id="${id}" ${aiData.schedule[id] ? 'checked' : ''}/> ${label}
        </label>`;

      document.getElementById("aiSuggestion").innerHTML = `
        <h3>💡 Suggestion IA & Validation</h3>
        <div style="margin-bottom: 10px;">
          <strong>Médicament suggéré:</strong> ${aiData.medicament}<br>
          <strong>Du:</strong> ${aiData.start_date} <strong>au</strong> ${aiData.end_date}<br>
          <strong>Horaires suggérés:</strong> ${Object.entries(aiData.schedule).filter(([_, v]) => v).map(([k]) => k).join(', ')}
        </div>

        <hr>

        <label>Médicament:</label>
        <input id="medicament" value="${aiData.medicament}" />
        
        <label>Date début:</label>
        <input type="date" id="start_date" value="${aiData.start_date}" />

        <label>Date fin:</label>
        <input type="date" id="end_date" value="${aiData.end_date}" />

        <label>Horaires:</label><br/>
        <div style="margin-bottom:10px;">
          ${renderCheckbox("matin", "Matin")}
          ${renderCheckbox("apres_midi", "Après-midi")}
          ${renderCheckbox("soir", "Soir")}
          ${renderCheckbox("nuit", "Nuit")}
        </div>

        <button onclick="validatePrescription()">✅ Valider et enregistrer</button>
        <p id="validationMessage"></p>
      `;
    })
    .catch(err => console.error("Erreur suggestion IA:", err));
}

function validatePrescription() {
  if (!aiData || !document.getElementById("medicament")) {
    alert("Soumettez d'abord une prescription à l'IA.");
    return;
  }

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
    .then(res => res.json())
    .then(() => {
      document.getElementById("validationMessage").innerText = '✅ Prescription enregistrée.';
    })
    .catch(err => console.error("Erreur validation prescription:", err));
}
