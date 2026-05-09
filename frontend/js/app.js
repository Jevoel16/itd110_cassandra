const API_URL = 'http://localhost:3000/api/water';

const csvFileInput = document.getElementById('csv-file');
const importBtn = document.getElementById('import-btn');
const importStatus = document.getElementById('import-status');
const dataForm = document.getElementById('data-form');
const formTitle = document.getElementById('form-title');
const submitBtn = document.getElementById('submit-btn');
const cancelBtn = document.getElementById('cancel-btn');
const geolocationInput = document.getElementById('geolocation');
const yearInput = document.getElementById('year');
const accessPercentageInput = document.getElementById('access-percentage');
const editOriginalGeolocation = document.getElementById('edit-original-geolocation');
const editOriginalYear = document.getElementById('edit-original-year');
const geolocationSelect = document.getElementById('geolocation-select');
const dataTbody = document.getElementById('data-tbody');
const noData = document.getElementById('no-data');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');
const pageInfo = document.getElementById('page-info');

let isEditing = false;

// Pagination state
let paginationStack = [];
let currentPage = 0;
let currentGeolocation = '';

// ---- Import ----
importBtn.addEventListener('click', async () => {
    const file = csvFileInput.files[0];
    if (!file) {
        showImportStatus('Please select a CSV file.', true);
        return;
    }

    const text = await file.text();
    importBtn.disabled = true;
    importBtn.textContent = 'Importing...';

    try {
        const res = await fetch(`${API_URL}/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ csv: text }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message);
        showImportStatus(data.message, false);
        loadRegions();
        resetPagination();
        loadData();
    } catch (err) {
        showImportStatus(err.message, true);
    } finally {
        importBtn.disabled = false;
        importBtn.textContent = 'Import CSV';
    }
});

function showImportStatus(msg, isError) {
    importStatus.textContent = msg;
    importStatus.className = isError ? 'status error' : 'status success';
    importStatus.classList.remove('hidden');
}

// ---- Region dropdown ----
async function loadRegions() {
    try {
        const res = await fetch(`${API_URL}/geolocations`);
        const geolocations = await res.json();
        geolocationSelect.innerHTML = '<option value="">All Geolocations</option>';
        geolocations.forEach((r) => {
            const opt = document.createElement('option');
            opt.value = r;
            opt.textContent = r;
            geolocationSelect.appendChild(opt);
        });
    } catch {
        // ignore
    }
}

geolocationSelect.addEventListener('change', () => {
    resetPagination();
    loadData();
});

// ---- Pagination Management ----
function resetPagination() {
    paginationStack = [null]; // Start with null for first page
    currentPage = 0;
    updatePaginationButtons();
}

function updatePaginationButtons() {
    prevBtn.disabled = currentPage === 0;
    pageInfo.textContent = `Page ${currentPage + 1}`;
}

prevBtn.addEventListener('click', () => {
    if (currentPage > 0) {
        currentPage--;
        loadData();
    }
});

nextBtn.addEventListener('click', () => {
    currentPage++;
    if (currentPage >= paginationStack.length) {
        paginationStack.push(null); // Placeholder for new page
    }
    loadData();
});

// ---- Load table data with pagination ----
async function loadData() {
    const selected = geolocationSelect.value;
    currentGeolocation = selected;
    
    try {
        let endpoint;
        let allRows = [];

        if (selected) {
            // Fetch paginated data for selected geolocation
            const pagingState = paginationStack[currentPage];
            const params = new URLSearchParams({ limit: 10 });
            if (pagingState) params.append('pagingState', pagingState);
            
            const res = await fetch(`${API_URL}/${encodeURIComponent(selected)}?${params}`);
            const response = await res.json();
            
            if (response.pagingState) {
                paginationStack[currentPage + 1] = response.pagingState;
            }
            
            nextBtn.disabled = !response.hasMore;
            allRows = response.data || response;
        } else {
            // Fetch all data with pagination
            const pagingState = paginationStack[currentPage];
            const params = new URLSearchParams({ limit: 10 });
            if (pagingState) params.append('pagingState', pagingState);
            
            const res = await fetch(`${API_URL}/all?${params}`);
            const response = await res.json();
            
            if (response.pagingState) {
                paginationStack[currentPage + 1] = response.pagingState;
            }
            
            nextBtn.disabled = !response.hasMore;
            allRows = response.data || response;
        }

        renderTable(allRows, selected === '');
        updatePaginationButtons();
    } catch (err) {
        console.error(err);
        renderTable([]);
    }
}

function renderTable(rows, sortByGeolocation = false) {
    dataTbody.innerHTML = '';

    if (rows.length === 0) {
        noData.classList.remove('hidden');
        return;
    }

    noData.classList.add('hidden');

    // Sort: if showing all data, sort by geolocation then year desc; otherwise just year desc
    if (sortByGeolocation) {
        rows.sort((a, b) => a.geolocation.localeCompare(b.geolocation) || b.year - a.year);
    } else {
        rows.sort((a, b) => b.year - a.year);
    }

    rows.forEach((r) => {
        const accessPercentage = Number(r.access_percentage ?? r.percentage ?? 0);
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${escapeHtml(r.geolocation)}</td>
            <td>${r.year}</td>
            <td>${Number.isFinite(accessPercentage) ? accessPercentage.toFixed(1) : ''}</td>
            <td>
                <button class="btn-edit" onclick="editRow('${escapeAttr(r.geolocation)}', ${r.year}, ${accessPercentage})">Edit</button>
                <button class="btn-delete" onclick="deleteRow('${escapeAttr(r.geolocation)}', ${r.year})">Delete</button>
            </td>
        `;
        dataTbody.appendChild(tr);
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function escapeAttr(text) {
    return text.replace(/'/g, "\\'").replace(/"/g, '\\"');
}

// ---- CRUD Form ----
dataForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const geolocation = geolocationInput.value.trim();
    const year = parseInt(yearInput.value);
    const accessPercentage = parseFloat(accessPercentageInput.value);

    try {
        if (isEditing) {
            const origGeolocation = editOriginalGeolocation.value;
            const origYear = parseInt(editOriginalYear.value);

            if (origGeolocation !== geolocation || origYear !== year) {
                await fetch(`${API_URL}/${encodeURIComponent(origGeolocation)}/${origYear}`, { method: 'DELETE' });
                await fetch(API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ geolocation, year, access_percentage: accessPercentage }),
                });
            } else {
                await fetch(`${API_URL}/${encodeURIComponent(geolocation)}/${year}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ access_percentage: accessPercentage }),
                });
            }
        } else {
            await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ geolocation, year, access_percentage: accessPercentage }),
            });
        }

        resetForm();
        resetPagination();
        loadRegions();
        loadData();
    } catch (err) {
        alert('Error: ' + err.message);
    }
});

function editRow(geolocation, year, accessPercentage) {
    isEditing = true;
    formTitle.textContent = 'Edit Data Point';
    submitBtn.textContent = 'Update';
    cancelBtn.classList.remove('hidden');

    editOriginalGeolocation.value = geolocation;
    editOriginalYear.value = year;
    geolocationInput.value = geolocation;
    yearInput.value = year;
    accessPercentageInput.value = accessPercentage;
    geolocationInput.focus();
}

async function deleteRow(geolocation, year) {
    if (!confirm(`Delete ${geolocation} (${year})?`)) return;

    try {
        await fetch(`${API_URL}/${encodeURIComponent(geolocation)}/${year}`, { method: 'DELETE' });
        resetPagination();
        loadData();
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

cancelBtn.addEventListener('click', resetForm);

function resetForm() {
    dataForm.reset();
    editOriginalGeolocation.value = '';
    editOriginalYear.value = '';
    isEditing = false;
    formTitle.textContent = 'Add Data Point';
    submitBtn.textContent = 'Add';
    cancelBtn.classList.add('hidden');
}

// ---- Init ----
loadRegions();
loadData();
