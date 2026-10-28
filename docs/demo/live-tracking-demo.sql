-- =============================================
-- DEMO DATA: 6 LIVE TRIPS ACROSS LUZON FOR THE DASHBOARD FLEET MAP / DISPATCH LIVE TRACKING
-- All times are relative to NOW(), so re-running this script "resets" the demo
-- to a live-looking state. Every demo trip carries booking_reference 'DEMO-LT-n'
-- and remarks 'DEMO — live tracking sample'; re-running first removes the
-- previous demo trips and frees their trucks / drivers / helpers.
--
--   1  ABC Manufacturing     Rigid ABC-1234       Yard → MICT → Laoag (Ilocos Norte) → Yard            IN TRANSIT north (~45%)
--   2  Davao Agricultural    TRC-001 + CHS-001    Yard → North Harbor → Tuguegarao (Cagayan) → NH → Yard ARRIVED at Tuguegarao (unloading)
--   3  Visayas Shipping      TRC-002 + CHS-002    Yard → South Harbor → Port of Legazpi (Albay) → Yard   IN TRANSIT south (~45%)
--   4  Manila Logistics Hub  Rigid XYZ-5678       Yard → La Trinidad (Benguet) → Yard                    RETURNING from Benguet
--   5  NCR Construction      TRC-003 + CHS-007    Yard → Subic Bay → Batangas Port → Yard               IN TRANSIT Subic → Batangas
--   6  Cebu Retail Group     TRC-004 + CHS-003    Yard → South Harbor → Baler (Aurora) → Yard            DISPATCHED, leaves in 30 min
--
-- Run:  mysql -uroot --default-character-set=utf8mb4 largafmsv2 < docs/demo/live-tracking-demo.sql
--       (the charset flag matters — without it the — dashes are stored as "?")
-- Planned leg times are ~1.3× the OSRM car drive time (loaded trucks are slower).
-- =============================================

-- ---------------------------------------------
-- 0. REMOVE A PREVIOUS DEMO RUN
-- ---------------------------------------------
UPDATE tbl_trucks t JOIN tbl_trip_assignments a ON t.truck_id IN (a.truck_id, a.tractor_id, a.chassis_id)
    JOIN tbl_trips tr ON tr.trip_id = a.trip_id
SET t.truck_status = 'AVAILABLE'
WHERE tr.booking_reference LIKE 'DEMO-LT-%' AND t.truck_status IN ('ASSIGNED','DISPATCHED','IN_TRANSIT','RETURNING');
UPDATE tbl_drivers d JOIN tbl_trip_assignments a ON a.driver_id = d.driver_id JOIN tbl_trips tr ON tr.trip_id = a.trip_id
SET d.driver_status = 'AVAILABLE'
WHERE tr.booking_reference LIKE 'DEMO-LT-%' AND d.driver_status IN ('ASSIGNED','ON_TRIP','RETURNING');
UPDATE tbl_helpers h JOIN tbl_trip_assignments a ON a.helper_id = h.helper_id JOIN tbl_trips tr ON tr.trip_id = a.trip_id
SET h.helper_status = 'AVAILABLE'
WHERE tr.booking_reference LIKE 'DEMO-LT-%' AND h.helper_status IN ('ASSIGNED','ON_TRIP');

DELETE i FROM tbl_dispatch_inspections i JOIN tbl_trips tr ON tr.trip_id = i.trip_id WHERE tr.booking_reference LIKE 'DEMO-LT-%';
DELETE c FROM tbl_dispatch_checklist c JOIN tbl_trips tr ON tr.trip_id = c.trip_id WHERE tr.booking_reference LIKE 'DEMO-LT-%';
DELETE e FROM tbl_dispatch_expenses e JOIN tbl_trips tr ON tr.trip_id = e.trip_id WHERE tr.booking_reference LIKE 'DEMO-LT-%';
DELETE d FROM tbl_dispatch d JOIN tbl_trips tr ON tr.trip_id = d.trip_id WHERE tr.booking_reference LIKE 'DEMO-LT-%';
DELETE w FROM tbl_trip_waypoints w JOIN tbl_trips tr ON tr.trip_id = w.trip_id WHERE tr.booking_reference LIKE 'DEMO-LT-%';
DELETE c FROM tbl_trip_cargo_items c JOIN tbl_trips tr ON tr.trip_id = c.trip_id WHERE tr.booking_reference LIKE 'DEMO-LT-%';
DELETE a FROM tbl_trip_assignments a JOIN tbl_trips tr ON tr.trip_id = a.trip_id WHERE tr.booking_reference LIKE 'DEMO-LT-%';
DELETE FROM tbl_trips WHERE booking_reference LIKE 'DEMO-LT-%';

-- ---------------------------------------------
-- NEXT CODES (same TRP-/DSP-/INS-YYYY-###### pattern the app generates)
-- ---------------------------------------------
SET @yr := YEAR(CURDATE());
SET @trp := (SELECT COALESCE(MAX(CAST(SUBSTRING(trip_code, 10) AS UNSIGNED)), 0) FROM tbl_trips WHERE trip_code LIKE CONCAT('TRP-', @yr, '-%'));
SET @dsp := (SELECT COALESCE(MAX(CAST(SUBSTRING(dispatch_code, 10) AS UNSIGNED)), 0) FROM tbl_dispatch WHERE dispatch_code LIKE CONCAT('DSP-', @yr, '-%'));
SET @ins := (SELECT COALESCE(MAX(CAST(SUBSTRING(inspection_code, 10) AS UNSIGNED)), 0) FROM tbl_dispatch_inspections WHERE inspection_code LIKE CONCAT('INS-', @yr, '-%'));

-- Pre-trip inspection files (reused sample uploads) so the inspection gate is cleared
SET @insp_form := 'uploads/dispatch_inspections/INSP_120_FORM_1792684161.png';
SET @insp_drv  := 'uploads/dispatch_inspections/INSP_120_DRIVER_SIGNATURE_1792684163.png';
SET @insp_insp := (SELECT inspector_signature FROM tbl_dispatch_inspections WHERE inspector_signature IS NOT NULL AND inspector_signature != '' ORDER BY inspection_id DESC LIMIT 1);

-- Shared stop: LARGA Truck Yard, Lingunan, Valenzuela City
SET @yard_lat := 14.7188793, @yard_lng := 120.9763424;

-- =============================================
-- TRIP 1 — IN TRANSIT NORTH: left MICT 5 h ago, due in Laoag in 6 h
-- =============================================
SET @start := NOW() - INTERVAL 380 MINUTE;
INSERT INTO tbl_trips (trip_code, customer_id, booking_reference, service_type, trip_type, priority, scheduled_date, pickup_date, expected_delivery_date,
    origin, destination, cargo_description, quantity, unit, estimated_weight, trip_status, remarks, created_by)
VALUES (CONCAT('TRP-', @yr, '-', LPAD(CAST(@trp + 1 AS UNSIGNED), 6, '0')), 1, 'DEMO-LT-1', 'Trucking', 'ONE_WAY', 'HIGH', DATE(@start), DATE(@start), CURDATE(),
    'Manila International Container Terminal (MICT), Tondo, Manila', 'ABC Ilocos Distribution Center, Laoag City, Ilocos Norte',
    'Imported machine parts (LCL), 12 crates', 12, 'Crates', 6200, 'IN_TRANSIT', 'DEMO — live tracking sample', 'ADMIN');
SET @t := LAST_INSERT_ID();
INSERT INTO tbl_trip_assignments (trip_id, vehicle_type, truck_id, truck_plate, driver_id, driver_name, helper_id, helper_name,
    assignment_date, dispatch_time, dispatch_location, odometer_before_trip, fuel_level, created_by)
VALUES (@t, 'RIGID', 6, 'ABC-1234', 12, 'Juan Dela Cruz', 13, 'Emilio Aguinaldo', DATE(@start), TIME(@start), 'LARGA Truck Yard', 45210, 100, 'ADMIN');
INSERT INTO tbl_dispatch (dispatch_code, trip_id, dispatch_date, dispatch_time, truck, driver, helper, origin, destination, odometer_out, fuel_level_out, dispatcher_name, created_by)
VALUES (CONCAT('DSP-', @yr, '-', LPAD(CAST(@dsp + 1 AS UNSIGNED), 6, '0')), @t, DATE(@start), TIME(@start), 'ABC-1234', 'Juan Dela Cruz', 'Emilio Aguinaldo',
    'Manila International Container Terminal (MICT), Tondo, Manila', 'ABC Ilocos Distribution Center, Laoag City, Ilocos Norte', 45210, 100, 'ADMIN', 'ADMIN');
SET @d := LAST_INSERT_ID();
INSERT INTO tbl_dispatch_inspections (inspection_code, dispatch_id, trip_id, inspection_date, inspection_time, truck_plate, inspector_name, final_status,
    inspection_form, driver_id, driver_name, driver_signature, driver_signed_at, inspector_signature, inspector_signed_at, remarks, created_by)
VALUES (CONCAT('INS-', @yr, '-', LPAD(CAST(@ins + 1 AS UNSIGNED), 6, '0')), @d, @t, DATE(@start), TIME(@start - INTERVAL 20 MINUTE), 'ABC-1234', 'A. Moquia', 'SAFE',
    @insp_form, 12, 'Juan Dela Cruz', @insp_drv, @start, @insp_insp, @start, 'Demo inspection — all clear.', 'ADMIN');
INSERT INTO tbl_trip_waypoints (trip_id, sequence, waypoint_type, waypoint_name, address, city, province, latitude, longitude,
    expected_arrival, expected_departure, actual_arrival, actual_departure, waypoint_status, created_by) VALUES
(@t, 1, 'GARAGE', 'LARGA Truck Yard', 'Lingunan, Valenzuela City', 'Valenzuela City', 'Metro Manila', @yard_lat, @yard_lng,
    NULL, @start, NULL, @start + INTERVAL 5 MINUTE, 'DEPARTED', 'DEMO'),
(@t, 2, 'PORT_TERMINAL', 'MICT — cargo pickup', 'MICT South Access Road, Tondo, Manila', 'Manila', 'Metro Manila', 14.6038906, 120.9522815,
    @start + INTERVAL 40 MINUTE, @start + INTERVAL 75 MINUTE, @start + INTERVAL 42 MINUTE, NOW() - INTERVAL 300 MINUTE, 'DEPARTED', 'DEMO'),
(@t, 3, 'DELIVERY_DESTINATION', 'ABC Ilocos Distribution Center', 'Laoag City, Ilocos Norte', 'Laoag City', 'Ilocos Norte', 18.1950211, 120.5917627,
    NOW() + INTERVAL 360 MINUTE, NOW() + INTERVAL 450 MINUTE, NULL, NULL, 'PENDING', 'DEMO'),
(@t, 4, 'GARAGE', 'LARGA Truck Yard', 'Lingunan, Valenzuela City', 'Valenzuela City', 'Metro Manila', @yard_lat, @yard_lng,
    NOW() + INTERVAL 1150 MINUTE, NULL, NULL, NULL, 'PENDING', 'DEMO');

-- =============================================
-- TRIP 2 — AT STOP: arrived in Tuguegarao 40 min ago (unloading), empty container to return to North Harbor
-- =============================================
SET @start := NOW() - INTERVAL 640 MINUTE;
INSERT INTO tbl_trips (trip_code, customer_id, booking_reference, service_type, trip_type, priority, scheduled_date, pickup_date, expected_delivery_date,
    origin, destination, cargo_description, quantity, unit, estimated_weight, trip_status, remarks, created_by)
VALUES (CONCAT('TRP-', @yr, '-', LPAD(CAST(@trp + 2 AS UNSIGNED), 6, '0')), 3, 'DEMO-LT-2', 'Container Trucking', 'ROUND_TRIP', 'NORMAL', DATE(@start), DATE(@start), CURDATE(),
    'Manila North Harbor, Tondo, Manila', 'Davao Agricultural — Cagayan Valley Hub, Tuguegarao City, Cagayan',
    'Fertilizer, 1 x 40ft container (800 bags)', 800, 'Bags', 20000, 'IN_TRANSIT', 'DEMO — live tracking sample', 'ADMIN');
SET @t := LAST_INSERT_ID();
INSERT INTO tbl_trip_assignments (trip_id, vehicle_type, tractor_id, tractor_plate, chassis_id, chassis_plate, chassis_type, driver_id, driver_name, helper_id, helper_name,
    assignment_date, dispatch_time, dispatch_location, odometer_before_trip, fuel_level, created_by)
VALUES (@t, 'TRACTOR_CHASSIS', 16, 'TRC-001', 26, 'CHS-001', 'OWNED', 13, 'Maria Santos', 14, 'Jose Rizal', DATE(@start), TIME(@start), 'LARGA Truck Yard', 61840, 100, 'ADMIN');
INSERT INTO tbl_dispatch (dispatch_code, trip_id, dispatch_date, dispatch_time, truck, driver, helper, origin, destination, odometer_out, fuel_level_out,
    container_required, container_number, container_type, container_release_port, container_release_date,
    container_return_required, container_return_port, container_return_status, dispatcher_name, created_by)
VALUES (CONCAT('DSP-', @yr, '-', LPAD(CAST(@dsp + 2 AS UNSIGNED), 6, '0')), @t, DATE(@start), TIME(@start), 'TRC-001 + CHS-001', 'Maria Santos', 'Jose Rizal',
    'Manila North Harbor, Tondo, Manila', 'Davao Agricultural — Cagayan Valley Hub, Tuguegarao City, Cagayan', 61840, 100,
    1, 'TCLU4419027', '40ft Dry Van', 'Manila North Harbor', DATE(@start), 1, 'Manila North Harbor Empty Yard', 'FOR_RETURN', 'ADMIN', 'ADMIN');
SET @d := LAST_INSERT_ID();
INSERT INTO tbl_dispatch_inspections (inspection_code, dispatch_id, trip_id, inspection_date, inspection_time, truck_plate, inspector_name, final_status,
    inspection_form, driver_id, driver_name, driver_signature, driver_signed_at, inspector_signature, inspector_signed_at, remarks, created_by)
VALUES (CONCAT('INS-', @yr, '-', LPAD(CAST(@ins + 2 AS UNSIGNED), 6, '0')), @d, @t, DATE(@start), TIME(@start - INTERVAL 20 MINUTE), 'TRC-001 + CHS-001', 'A. Moquia', 'SAFE',
    @insp_form, 13, 'Maria Santos', @insp_drv, @start, @insp_insp, @start, 'Demo inspection — all clear.', 'ADMIN');
INSERT INTO tbl_trip_waypoints (trip_id, sequence, waypoint_type, waypoint_name, address, city, province, latitude, longitude,
    expected_arrival, expected_departure, actual_arrival, actual_departure, waypoint_status, created_by) VALUES
(@t, 1, 'GARAGE', 'LARGA Truck Yard', 'Lingunan, Valenzuela City', 'Valenzuela City', 'Metro Manila', @yard_lat, @yard_lng,
    NULL, @start, NULL, @start + INTERVAL 3 MINUTE, 'DEPARTED', 'DEMO'),
(@t, 2, 'PORT_TERMINAL', 'Manila North Harbor — container pickup', 'Manila North Harbor, Tondo, Manila', 'Manila', 'Metro Manila', 14.6094435, 120.9600768,
    @start + INTERVAL 35 MINUTE, @start + INTERVAL 70 MINUTE, @start + INTERVAL 38 MINUTE, @start + INTERVAL 75 MINUTE, 'DEPARTED', 'DEMO'),
(@t, 3, 'DELIVERY_DESTINATION', 'Davao Agricultural — Cagayan Valley Hub', 'Tuguegarao City, Cagayan', 'Tuguegarao City', 'Cagayan', 17.6505274, 121.7538140,
    NOW() - INTERVAL 50 MINUTE, NOW() + INTERVAL 50 MINUTE, NOW() - INTERVAL 40 MINUTE, NULL, 'ARRIVED', 'DEMO'),
(@t, 4, 'RETURN_POINT', 'Manila North Harbor — empty container return', 'Manila North Harbor, Tondo, Manila', 'Manila', 'Metro Manila', 14.6094435, 120.9600768,
    NOW() + INTERVAL 620 MINUTE, NOW() + INTERVAL 660 MINUTE, NULL, NULL, 'PENDING', 'DEMO'),
(@t, 5, 'GARAGE', 'LARGA Truck Yard', 'Lingunan, Valenzuela City', 'Valenzuela City', 'Metro Manila', @yard_lat, @yard_lng,
    NOW() + INTERVAL 700 MINUTE, NULL, NULL, NULL, 'PENDING', 'DEMO');

-- =============================================
-- TRIP 3 — IN TRANSIT SOUTH: left South Harbor 4 h ago, due at Port of Legazpi in 5 h
-- =============================================
SET @start := NOW() - INTERVAL 300 MINUTE;
INSERT INTO tbl_trips (trip_code, customer_id, booking_reference, service_type, trip_type, priority, scheduled_date, pickup_date, expected_delivery_date,
    origin, destination, cargo_description, quantity, unit, estimated_weight, trip_status, remarks, created_by)
VALUES (CONCAT('TRP-', @yr, '-', LPAD(CAST(@trp + 3 AS UNSIGNED), 6, '0')), 7, 'DEMO-LT-3', 'Container Trucking', 'ONE_WAY', 'HIGH', DATE(@start), DATE(@start), CURDATE(),
    'Manila South Harbor, Port Area, Manila', 'Port of Legazpi, Legazpi City, Albay',
    'Transshipment cargo, 1 x 20ft dry container', 1, 'Container', 14500, 'IN_TRANSIT', 'DEMO — live tracking sample', 'ADMIN');
SET @t := LAST_INSERT_ID();
INSERT INTO tbl_trip_assignments (trip_id, vehicle_type, tractor_id, tractor_plate, chassis_id, chassis_plate, chassis_type, driver_id, driver_name, helper_id, helper_name,
    assignment_date, dispatch_time, dispatch_location, odometer_before_trip, fuel_level, created_by)
VALUES (@t, 'TRACTOR_CHASSIS', 17, 'TRC-002', 27, 'CHS-002', 'OWNED', 14, 'Pedro Reyes', 15, 'Gabriela Silang', DATE(@start), TIME(@start), 'LARGA Truck Yard', 38770, 100, 'ADMIN');
INSERT INTO tbl_dispatch (dispatch_code, trip_id, dispatch_date, dispatch_time, truck, driver, helper, origin, destination, odometer_out, fuel_level_out,
    container_required, container_number, container_type, container_release_port, container_release_date, dispatcher_name, created_by)
VALUES (CONCAT('DSP-', @yr, '-', LPAD(CAST(@dsp + 3 AS UNSIGNED), 6, '0')), @t, DATE(@start), TIME(@start), 'TRC-002 + CHS-002', 'Pedro Reyes', 'Gabriela Silang',
    'Manila South Harbor, Port Area, Manila', 'Port of Legazpi, Legazpi City, Albay', 38770, 100,
    1, 'MSKU2208815', '20ft Dry Van', 'Manila South Harbor', DATE(@start), 'ADMIN', 'ADMIN');
SET @d := LAST_INSERT_ID();
INSERT INTO tbl_dispatch_inspections (inspection_code, dispatch_id, trip_id, inspection_date, inspection_time, truck_plate, inspector_name, final_status,
    inspection_form, driver_id, driver_name, driver_signature, driver_signed_at, inspector_signature, inspector_signed_at, remarks, created_by)
VALUES (CONCAT('INS-', @yr, '-', LPAD(CAST(@ins + 3 AS UNSIGNED), 6, '0')), @d, @t, DATE(@start), TIME(@start - INTERVAL 20 MINUTE), 'TRC-002 + CHS-002', 'A. Moquia', 'SAFE',
    @insp_form, 14, 'Pedro Reyes', @insp_drv, @start, @insp_insp, @start, 'Demo inspection — all clear.', 'ADMIN');
INSERT INTO tbl_trip_waypoints (trip_id, sequence, waypoint_type, waypoint_name, address, city, province, latitude, longitude,
    expected_arrival, expected_departure, actual_arrival, actual_departure, waypoint_status, created_by) VALUES
(@t, 1, 'GARAGE', 'LARGA Truck Yard', 'Lingunan, Valenzuela City', 'Valenzuela City', 'Metro Manila', @yard_lat, @yard_lng,
    NULL, @start, NULL, @start + INTERVAL 2 MINUTE, 'DEPARTED', 'DEMO'),
(@t, 2, 'PORT_TERMINAL', 'Manila South Harbor — container pickup', 'Port Area, Manila', 'Manila', 'Metro Manila', 14.5889597, 120.9686124,
    @start + INTERVAL 40 MINUTE, @start + INTERVAL 60 MINUTE, @start + INTERVAL 38 MINUTE, NOW() - INTERVAL 240 MINUTE, 'DEPARTED', 'DEMO'),
(@t, 3, 'PORT_TERMINAL', 'Port of Legazpi — vessel loading', 'Port of Legazpi City, Legazpi, Albay', 'Legazpi City', 'Albay', 13.1460150, 123.7568159,
    NOW() + INTERVAL 300 MINUTE, NOW() + INTERVAL 360 MINUTE, NULL, NULL, 'PENDING', 'DEMO'),
(@t, 4, 'GARAGE', 'LARGA Truck Yard', 'Lingunan, Valenzuela City', 'Valenzuela City', 'Metro Manila', @yard_lat, @yard_lng,
    NOW() + INTERVAL 920 MINUTE, NULL, NULL, NULL, 'PENDING', 'DEMO');

-- =============================================
-- TRIP 4 — RETURNING: delivered in La Trinidad, left 90 min ago, due back at the yard in ~4 h
-- =============================================
SET @start := NOW() - INTERVAL 480 MINUTE;
INSERT INTO tbl_trips (trip_code, customer_id, booking_reference, service_type, trip_type, priority, scheduled_date, pickup_date, expected_delivery_date,
    origin, destination, cargo_description, quantity, unit, estimated_weight, trip_status, remarks, created_by)
VALUES (CONCAT('TRP-', @yr, '-', LPAD(CAST(@trp + 4 AS UNSIGNED), 6, '0')), 5, 'DEMO-LT-4', 'Trucking', 'ONE_WAY', 'NORMAL', DATE(@start), DATE(@start), CURDATE(),
    'LARGA Truck Yard, Valenzuela City', 'La Trinidad Vegetable Trading Post, La Trinidad, Benguet',
    'Crates and packaging supplies, 40 pallets', 40, 'Pallets', 7800, 'IN_TRANSIT', 'DEMO — live tracking sample', 'ADMIN');
SET @t := LAST_INSERT_ID();
INSERT INTO tbl_trip_assignments (trip_id, vehicle_type, truck_id, truck_plate, driver_id, driver_name, helper_id, helper_name,
    assignment_date, dispatch_time, dispatch_location, odometer_before_trip, fuel_level, created_by)
VALUES (@t, 'RIGID', 7, 'XYZ-5678', 15, 'Anna Lopez', 16, 'Diego Silang', DATE(@start), TIME(@start), 'LARGA Truck Yard', 52990, 100, 'ADMIN');
INSERT INTO tbl_dispatch (dispatch_code, trip_id, dispatch_date, dispatch_time, truck, driver, helper, origin, destination, odometer_out, fuel_level_out, dispatcher_name, created_by)
VALUES (CONCAT('DSP-', @yr, '-', LPAD(CAST(@dsp + 4 AS UNSIGNED), 6, '0')), @t, DATE(@start), TIME(@start), 'XYZ-5678', 'Anna Lopez', 'Diego Silang',
    'LARGA Truck Yard, Valenzuela City', 'La Trinidad Vegetable Trading Post, La Trinidad, Benguet', 52990, 100, 'ADMIN', 'ADMIN');
SET @d := LAST_INSERT_ID();
INSERT INTO tbl_dispatch_inspections (inspection_code, dispatch_id, trip_id, inspection_date, inspection_time, truck_plate, inspector_name, final_status,
    inspection_form, driver_id, driver_name, driver_signature, driver_signed_at, inspector_signature, inspector_signed_at, remarks, created_by)
VALUES (CONCAT('INS-', @yr, '-', LPAD(CAST(@ins + 4 AS UNSIGNED), 6, '0')), @d, @t, DATE(@start), TIME(@start - INTERVAL 20 MINUTE), 'XYZ-5678', 'A. Moquia', 'SAFE',
    @insp_form, 15, 'Anna Lopez', @insp_drv, @start, @insp_insp, @start, 'Demo inspection — all clear.', 'ADMIN');
INSERT INTO tbl_trip_waypoints (trip_id, sequence, waypoint_type, waypoint_name, address, city, province, latitude, longitude,
    expected_arrival, expected_departure, actual_arrival, actual_departure, waypoint_status, created_by) VALUES
(@t, 1, 'GARAGE', 'LARGA Truck Yard', 'Lingunan, Valenzuela City', 'Valenzuela City', 'Metro Manila', @yard_lat, @yard_lng,
    NULL, @start, NULL, @start + INTERVAL 4 MINUTE, 'DEPARTED', 'DEMO'),
(@t, 2, 'DELIVERY_DESTINATION', 'La Trinidad Vegetable Trading Post', 'La Trinidad, Benguet', 'La Trinidad', 'Benguet', 16.4496859, 120.5762194,
    @start + INTERVAL 310 MINUTE, @start + INTERVAL 380 MINUTE, @start + INTERVAL 318 MINUTE, NOW() - INTERVAL 90 MINUTE, 'DEPARTED', 'DEMO'),
(@t, 3, 'GARAGE', 'LARGA Truck Yard', 'Lingunan, Valenzuela City', 'Valenzuela City', 'Metro Manila', @yard_lat, @yard_lng,
    NOW() + INTERVAL 225 MINUTE, NULL, NULL, NULL, 'PENDING', 'DEMO');

-- =============================================
-- TRIP 5 — IN TRANSIT: picked up at Subic, left 70 min ago, due at Batangas Port in ~3.5 h
-- =============================================
SET @start := NOW() - INTERVAL 260 MINUTE;
INSERT INTO tbl_trips (trip_code, customer_id, booking_reference, service_type, trip_type, priority, scheduled_date, pickup_date, expected_delivery_date,
    origin, destination, cargo_description, quantity, unit, estimated_weight, trip_status, remarks, created_by)
VALUES (CONCAT('TRP-', @yr, '-', LPAD(CAST(@trp + 5 AS UNSIGNED), 6, '0')), 10, 'DEMO-LT-5', 'Trucking', 'ONE_WAY', 'URGENT', DATE(@start), DATE(@start), CURDATE(),
    'Subic Bay International Container Terminal, Subic Bay Freeport Zone', 'Batangas Port, Batangas City',
    'Structural steel beams on flatbed', 24, 'Pieces', 26500, 'IN_TRANSIT', 'DEMO — live tracking sample', 'ADMIN');
SET @t := LAST_INSERT_ID();
INSERT INTO tbl_trip_assignments (trip_id, vehicle_type, tractor_id, tractor_plate, chassis_id, chassis_plate, chassis_type, driver_id, driver_name, helper_id, helper_name,
    assignment_date, dispatch_time, dispatch_location, odometer_before_trip, fuel_level, created_by)
VALUES (@t, 'TRACTOR_CHASSIS', 18, 'TRC-003', 32, 'CHS-007', 'OWNED', 16, 'Ramon Cruz', 17, 'Antonio Luna', DATE(@start), TIME(@start), 'LARGA Truck Yard', 70115, 100, 'ADMIN');
INSERT INTO tbl_dispatch (dispatch_code, trip_id, dispatch_date, dispatch_time, truck, driver, helper, origin, destination, odometer_out, fuel_level_out, dispatcher_name, created_by)
VALUES (CONCAT('DSP-', @yr, '-', LPAD(CAST(@dsp + 5 AS UNSIGNED), 6, '0')), @t, DATE(@start), TIME(@start), 'TRC-003 + CHS-007', 'Ramon Cruz', 'Antonio Luna',
    'Subic Bay International Container Terminal, Subic Bay Freeport Zone', 'Batangas Port, Batangas City', 70115, 100, 'ADMIN', 'ADMIN');
SET @d := LAST_INSERT_ID();
INSERT INTO tbl_dispatch_inspections (inspection_code, dispatch_id, trip_id, inspection_date, inspection_time, truck_plate, inspector_name, final_status,
    inspection_form, driver_id, driver_name, driver_signature, driver_signed_at, inspector_signature, inspector_signed_at, remarks, created_by)
VALUES (CONCAT('INS-', @yr, '-', LPAD(CAST(@ins + 5 AS UNSIGNED), 6, '0')), @d, @t, DATE(@start), TIME(@start - INTERVAL 20 MINUTE), 'TRC-003 + CHS-007', 'A. Moquia', 'SAFE',
    @insp_form, 16, 'Ramon Cruz', @insp_drv, @start, @insp_insp, @start, 'Demo inspection — all clear. Load lashed with 8 chains.', 'ADMIN');
INSERT INTO tbl_trip_waypoints (trip_id, sequence, waypoint_type, waypoint_name, address, city, province, latitude, longitude,
    expected_arrival, expected_departure, actual_arrival, actual_departure, waypoint_status, created_by) VALUES
(@t, 1, 'GARAGE', 'LARGA Truck Yard', 'Lingunan, Valenzuela City', 'Valenzuela City', 'Metro Manila', @yard_lat, @yard_lng,
    NULL, @start, NULL, @start + INTERVAL 2 MINUTE, 'DEPARTED', 'DEMO'),
(@t, 2, 'PICKUP_LOCATION', 'Subic Bay International Container Terminal', 'Subic Bay Freeport Zone, Zambales', 'Subic Bay Freeport Zone', 'Zambales', 14.8019080, 120.2639232,
    @start + INTERVAL 140 MINUTE, @start + INTERVAL 185 MINUTE, @start + INTERVAL 145 MINUTE, NOW() - INTERVAL 70 MINUTE, 'DEPARTED', 'DEMO'),
(@t, 3, 'DELIVERY_DESTINATION', 'Batangas Port — NCR Construction project yard', 'Batangas Port, Batangas City', 'Batangas City', 'Batangas', 13.7538983, 121.0436530,
    NOW() + INTERVAL 210 MINUTE, NOW() + INTERVAL 290 MINUTE, NULL, NULL, 'PENDING', 'DEMO'),
(@t, 4, 'GARAGE', 'LARGA Truck Yard', 'Lingunan, Valenzuela City', 'Valenzuela City', 'Metro Manila', @yard_lat, @yard_lng,
    NOW() + INTERVAL 460 MINUTE, NULL, NULL, NULL, 'PENDING', 'DEMO');

-- =============================================
-- TRIP 6 — DISPATCHED: inspected and released, leaves the yard for Baler in 30 min
-- =============================================
SET @start := NOW() + INTERVAL 30 MINUTE;
INSERT INTO tbl_trips (trip_code, customer_id, booking_reference, service_type, trip_type, priority, scheduled_date, pickup_date, expected_delivery_date,
    origin, destination, cargo_description, quantity, unit, estimated_weight, trip_status, remarks, created_by)
VALUES (CONCAT('TRP-', @yr, '-', LPAD(CAST(@trp + 6 AS UNSIGNED), 6, '0')), 4, 'DEMO-LT-6', 'Container Trucking', 'ONE_WAY', 'NORMAL', CURDATE(), CURDATE(), CURDATE(),
    'Manila South Harbor, Port Area, Manila', 'Cebu Retail Group — Baler Store, Baler, Aurora',
    'Chilled retail goods, 1 x 40ft reefer', 1, 'Container', 18000, 'DISPATCHED', 'DEMO — live tracking sample', 'ADMIN');
SET @t := LAST_INSERT_ID();
INSERT INTO tbl_trip_assignments (trip_id, vehicle_type, tractor_id, tractor_plate, chassis_id, chassis_plate, chassis_type, driver_id, driver_name, helper_id, helper_name,
    assignment_date, dispatch_time, dispatch_location, odometer_before_trip, fuel_level, created_by)
VALUES (@t, 'TRACTOR_CHASSIS', 19, 'TRC-004', 28, 'CHS-003', 'OWNED', 17, 'Elena Rivera', 18, 'Gregorio Del Pilar', CURDATE(), TIME(@start), 'LARGA Truck Yard', 29340, 100, 'ADMIN');
INSERT INTO tbl_dispatch (dispatch_code, trip_id, dispatch_date, dispatch_time, truck, driver, helper, origin, destination, odometer_out, fuel_level_out,
    container_required, container_number, container_type, container_release_port, container_release_date, dispatcher_name, created_by)
VALUES (CONCAT('DSP-', @yr, '-', LPAD(CAST(@dsp + 6 AS UNSIGNED), 6, '0')), @t, CURDATE(), TIME(@start), 'TRC-004 + CHS-003', 'Elena Rivera', 'Gregorio Del Pilar',
    'Manila South Harbor, Port Area, Manila', 'Cebu Retail Group — Baler Store, Baler, Aurora', 29340, 100,
    1, 'SEGU5523091', '40ft Reefer', 'Manila South Harbor', CURDATE(), 'ADMIN', 'ADMIN');
SET @d := LAST_INSERT_ID();
INSERT INTO tbl_dispatch_inspections (inspection_code, dispatch_id, trip_id, inspection_date, inspection_time, truck_plate, inspector_name, final_status,
    inspection_form, driver_id, driver_name, driver_signature, driver_signed_at, inspector_signature, inspector_signed_at, remarks, created_by)
VALUES (CONCAT('INS-', @yr, '-', LPAD(CAST(@ins + 6 AS UNSIGNED), 6, '0')), @d, @t, CURDATE(), TIME(NOW() - INTERVAL 10 MINUTE), 'TRC-004 + CHS-003', 'A. Moquia', 'SAFE',
    @insp_form, 17, 'Elena Rivera', @insp_drv, NOW() - INTERVAL 10 MINUTE, @insp_insp, NOW() - INTERVAL 10 MINUTE, 'Demo inspection — reefer unit tested OK.', 'ADMIN');
INSERT INTO tbl_trip_waypoints (trip_id, sequence, waypoint_type, waypoint_name, address, city, province, latitude, longitude,
    expected_arrival, expected_departure, actual_arrival, actual_departure, waypoint_status, created_by) VALUES
(@t, 1, 'GARAGE', 'LARGA Truck Yard', 'Lingunan, Valenzuela City', 'Valenzuela City', 'Metro Manila', @yard_lat, @yard_lng,
    NULL, @start, NULL, NULL, 'PENDING', 'DEMO'),
(@t, 2, 'PORT_TERMINAL', 'Manila South Harbor — reefer pickup', 'Port Area, Manila', 'Manila', 'Metro Manila', 14.5889597, 120.9686124,
    @start + INTERVAL 40 MINUTE, @start + INTERVAL 100 MINUTE, NULL, NULL, 'PENDING', 'DEMO'),
(@t, 3, 'DELIVERY_DESTINATION', 'Cebu Retail Group — Baler Store', 'Baler, Aurora', 'Baler', 'Aurora', 15.7590860, 121.5627247,
    @start + INTERVAL 430 MINUTE, @start + INTERVAL 500 MINUTE, NULL, NULL, 'PENDING', 'DEMO'),
(@t, 4, 'GARAGE', 'LARGA Truck Yard', 'Lingunan, Valenzuela City', 'Valenzuela City', 'Metro Manila', @yard_lat, @yard_lng,
    @start + INTERVAL 840 MINUTE, NULL, NULL, NULL, 'PENDING', 'DEMO');

-- ---------------------------------------------
-- UNIT + CREW STATUS (same mapping as FMS_Dispatch_Model::syncTripResources)
-- ---------------------------------------------
UPDATE tbl_trucks SET truck_status = 'IN_TRANSIT' WHERE truck_id IN (6, 16, 26, 17, 27, 7, 18, 32);
UPDATE tbl_trucks SET truck_status = 'DISPATCHED' WHERE truck_id IN (19, 28);
UPDATE tbl_drivers SET driver_status = 'ON_TRIP' WHERE driver_id IN (12, 13, 14, 15, 16, 17);
UPDATE tbl_helpers SET helper_status = 'ON_TRIP' WHERE helper_id IN (13, 14, 15, 16, 17, 18);
