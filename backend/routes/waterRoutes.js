const express = require('express');
const router = express.Router();

const {
    importDataset,
    getGeolocations,
    getByGeolocation,
    getAllData,
    getOne,
    createOne,
    updateOne,
    deleteOne,
} = require('../controllers/waterController');

router.post('/import', importDataset);
router.get('/geolocations', getGeolocations);
router.get('/all', getAllData);
router.post('/', createOne);
router.get('/:geolocation', getByGeolocation);
router.get('/:geolocation/:year', getOne);
router.put('/:geolocation/:year', updateOne);
router.delete('/:geolocation/:year', deleteOne);

module.exports = router;