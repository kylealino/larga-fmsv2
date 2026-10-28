// =============================================
// DASHBOARD — LIVE FLEET TRACKING
// Every trip out on the road (DISPATCHED / IN_TRANSIT / DELIVERED) on one map.
// Positions are estimated by FleetTrack (fleet-tracking-core.js) from the
// waypoint arrival/departure times recorded in Dispatch — there is no GPS feed.
//
// Built to be read at a glance (incl. by older users):
// - Each truck has ONE color: marker, label card, stops, destination flag and
//   route all use it (driven part = dotted trail, road ahead = solid line with
//   direction arrows). There is no second color code for status.
// - Status is written in plain words on the truck's label card and in the list
//   ("On the way to Laoag City · Arrives about 6:30 AM").
// - Label cards never overlap: a less important card shrinks to the plate only,
//   or hides until hovered (see declutter()).
// - Hover a truck (list row, marker or route) to emphasize its route and fade
//   the rest; click to keep that focus and zoom to the whole route.
// =============================================
(function() {
    var POLL_MS = 30000;   // re-fetch the fleet (statuses recorded by dispatchers)
    var TICK_MS = 15000;   // re-position in-transit trucks between polls
    var SELECTION_KEY = 'lf_hidden_trips'; // per-viewer: trucks this viewer unticked
    var DIM_FACTOR = 0.12; // opacity multiplier for trucks that aren't emphasized
    var ARROW_EVERY_M = 70000; // one direction arrow per ~70 km of road ahead

    // Truck identity colors — high contrast on the OSM basemap, kept clear of the overdue red
    var TRUCK_COLORS = ['#2563eb', '#d946ef', '#16a34a', '#ea580c', '#7c3aed', '#0891b2', '#ca8a04', '#0f766e', '#9d174d', '#4338ca'];
    // Status words + icons (plain language; color only tints the icon)
    var PHASES = {
        'IN_TRANSIT': { label: 'On the way', icon: 'bi-arrow-right-circle-fill', color: '#2563eb' },
        'AT_STOP':    { label: 'At a stop', icon: 'bi-box-seam-fill', color: '#7c3aed' },
        'AWAITING':   { label: 'Waiting to leave', icon: 'bi-hourglass-split', color: '#64748b' },
        'RETURNING':  { label: 'Going back', icon: 'bi-arrow-return-left', color: '#d97706' },
        'COMPLETED':  { label: 'Finished', icon: 'bi-check-circle-fill', color: '#10b981' }
    };
    var LATE = { label: 'Running late', icon: 'bi-exclamation-triangle-fill', color: '#dc2626' };
    var OVERDUE_COLOR = LATE.color;
    var LOADING_TYPES = ['PORT_TERMINAL', 'PICKUP_LOCATION', 'EMPTY_CONTAINER_PICKUP'];
    var UNLOADING_TYPES = ['DELIVERY_DESTINATION', 'CLIENT_WAREHOUSE'];

    var $root, feedUrl, dispatchUrl;
    var map = null, layer = null;
    var trips = [];             // latest feed rows, each with derived fields (see enrich)
    var routes = {};            // trip_id -> route from FleetTrack.fetchRoute
    var hidden = {};            // trip_id -> true when unticked
    var phaseFilter = 'ALL';
    var searchText = '';
    var tripDrawn = {};         // trip_id -> { lines: [{layer, base}], marks: [layer], bounds, truck }
    var openPopupTrip = null;   // keep a truck's popup open across redraws
    var focusedTrip = null;     // sticky emphasis (click)
    var hoverTrip = null;       // transient emphasis (hover)
    var fittedOnce = false;
    var colorByTrip = {};
    var nextColor = 0;
    var esc;

    function loadHidden() {
        try { hidden = JSON.parse(localStorage.getItem(SELECTION_KEY) || '{}') || {}; } catch(e) { hidden = {}; }
    }
    function saveHidden() {
        try { localStorage.setItem(SELECTION_KEY, JSON.stringify(hidden)); } catch(e) { /* per-viewer convenience only */ }
    }

    function setMapStatus(text) {
        if(text) $('#lfMapStatus').text(text).show(); else $('#lfMapStatus').hide();
    }

    // Colors are handed out in trip-code order on first sight and then kept for the session
    function truckColor(trip) {
        if(!colorByTrip[trip.trip_id]) colorByTrip[trip.trip_id] = TRUCK_COLORS[nextColor++ % TRUCK_COLORS.length];
        return colorByTrip[trip.trip_id];
    }

    // Derive progress/status for a trip (and its position once its route is known)
    function enrich(trip) {
        var wps = trip.waypoints || [];
        trip.progress = FleetTrack.computeProgress(wps);
        trip.text = FleetTrack.describe(wps, trip.progress);
        trip.plotted = FleetTrack.plottedOf(wps);
        trip.analysis = routes[trip.trip_id] ? FleetTrack.analyze(wps, trip.plotted, routes[trip.trip_id], trip.progress) : null;
        trip.overdue = !!(trip.analysis && trip.analysis.overdue);
        trip.phase = trip.progress.phase;
        var phase = trip.overdue ? LATE : (PHASES[trip.phase] || PHASES.AWAITING);
        trip.statusColor = phase.color;
        trip.statusLabel = phase.label;
        trip.statusIcon = phase.icon;
        trip.color = truckColor(trip);
        trip.plain = plainStatus(trip);
        return trip;
    }

    // Short place name for sentences: the town, or the stop name; the yard is "the yard"
    function placeName(w) {
        if(!w) return '';
        if(w.waypoint_type === 'GARAGE') return 'the yard';
        return w.city || w.waypoint_name || '';
    }

    // Plain-language status: { headline: 'On the way to Laoag City', detail: 'Arrives about 6:30 AM' }
    function plainStatus(t) {
        var wps = t.waypoints || [];
        var p = t.progress;
        if(!wps.length) return { headline: 'No route planned yet', detail: 'Add stops in Trip Scheduling' };
        var cur = wps[p.currentIdx];
        var next = p.nextIdx >= 0 ? wps[p.nextIdx] : null;
        var eta = t.analysis && t.analysis.nextEta ? FleetTrack.formatTime(t.analysis.nextEta) : null;
        var time = function(v) { var d = FleetTrack.parseDate(v); return d ? FleetTrack.formatTime(d) : null; };

        if(p.state === 'NOT_STARTED') {
            // Not started: the truck sits at stop #1, so the first stop to drive to is #2
            var leaves = time(cur.expected_departure);
            var first = wps[1];
            return {
                headline: cur.waypoint_type === 'GARAGE' ? 'Waiting to leave the yard' : 'Waiting to leave ' + placeName(cur),
                detail: (leaves ? 'Leaves at ' + leaves : 'Ready to go') + (first ? ' · first stop: ' + placeName(first) : '')
            };
        }
        if(p.state === 'IN_TRANSIT') {
            return {
                headline: (p.phase === 'RETURNING' ? 'Going back to ' : 'On the way to ') + placeName(next),
                detail: t.overdue ? 'Late — was due at ' + (eta || '—') : (eta ? 'Arrives about ' + eta : '')
            };
        }
        if(p.state === 'AT_STOP') {
            var verb = UNLOADING_TYPES.indexOf(cur.waypoint_type) !== -1 ? 'Unloading at '
                : LOADING_TYPES.indexOf(cur.waypoint_type) !== -1 ? 'Loading at '
                : cur.waypoint_type === 'RETURN_POINT' ? 'Returning the container at '
                : cur.waypoint_type === 'GARAGE' ? '' : 'Stopped at ';
            var since = time(cur.actual_arrival);
            return {
                headline: verb ? verb + placeName(cur) : 'At the yard',
                detail: (since ? 'Since ' + since : '') + (next ? (since ? ' · ' : '') + 'next: ' + placeName(next) : '')
            };
        }
        return { headline: 'Trip finished', detail: 'Back at ' + placeName(cur) };
    }

    // One sentence for the whole fleet
    function renderSummary() {
        if(!trips.length) { $('#lfSummary').html('<i class="bi bi-truck"></i> No trucks are out on a trip right now.'); return; }
        var count = function(phase) { return trips.filter(function(t) { return t.phase === phase; }).length; };
        var parts = [];
        $.each([['IN_TRANSIT', 'on the way'], ['AT_STOP', 'at a stop (loading/unloading)'], ['RETURNING', 'going back'], ['AWAITING', 'waiting to leave']], function(_, x) {
            var n = count(x[0]);
            if(n) parts.push('<b>' + n + '</b> ' + x[1]);
        });
        var late = trips.filter(function(t) { return t.overdue; }).length;
        $('#lfSummary').html('<i class="bi bi-truck"></i> <b>' + trips.length + ' truck' + (trips.length > 1 ? 's' : '') + '</b> out right now: ' + parts.join(', ') + '. '
            + (late ? '<span class="lf-sum-late"><i class="bi bi-exclamation-triangle-fill"></i> ' + late + ' running late.</span>'
                    : '<span class="lf-sum-ok"><i class="bi bi-check-circle-fill"></i> All on schedule.</span>'));
    }

    function matchesFilters(trip) {
        if(phaseFilter === 'OVERDUE' && !trip.overdue) return false;
        if(phaseFilter !== 'ALL' && phaseFilter !== 'OVERDUE' && trip.phase !== phaseFilter) return false;
        if(searchText) {
            var hay = [trip.unit_label, trip.trip_code, trip.driver_name, trip.helper_name, trip.customer_name, trip.destination].join(' ').toLowerCase();
            if(hay.indexOf(searchText) === -1) return false;
        }
        return true;
    }

    function isShown(trip) {
        return matchesFilters(trip) && !hidden[trip.trip_id];
    }

    function tripById(id) {
        for(var i = 0; i < trips.length; i++) if(trips[i].trip_id == id) return trips[i];
        return null;
    }

    // ==============================
    // CHIPS (status filter with counts)
    // ==============================
    function renderChips() {
        var counts = { ALL: trips.length, OVERDUE: 0 };
        $.each(PHASES, function(k) { counts[k] = 0; });
        $.each(trips, function(_, t) {
            counts[t.phase] = (counts[t.phase] || 0) + 1;
            if(t.overdue) counts.OVERDUE++;
        });
        var chips = [
            ['ALL', { label: 'All trucks', icon: 'bi-truck', color: '#1a202c' }],
            ['IN_TRANSIT', PHASES.IN_TRANSIT], ['AT_STOP', PHASES.AT_STOP], ['AWAITING', PHASES.AWAITING],
            ['RETURNING', PHASES.RETURNING], ['OVERDUE', LATE]
        ];
        var html = '';
        $.each(chips, function(_, c) {
            var key = c[0], ph = c[1];
            var n = counts[key] || 0;
            html += '<button type="button" class="lf-chip' + (phaseFilter === key ? ' active' : '') + (n ? '' : ' empty') + '" data-phase="' + key + '">'
                + '<i class="bi ' + ph.icon + '" style="color:' + ph.color + '"></i>' + ph.label + ' <b>' + n + '</b></button>';
        });
        $('#lfChips').html(html);
    }

    // ==============================
    // TRUCK LIST (multi-select; doubles as the color legend)
    // ==============================
    function renderList() {
        var list = trips.filter(matchesFilters);
        var shown = list.filter(function(t) { return !hidden[t.trip_id]; }).length;
        $('#lfSelCount').text(trips.length ? shown + ' of ' + list.length + ' shown' : '—');

        if(!trips.length) {
            $('#lfList').html('<div class="lf-empty"><i class="bi bi-truck" style="font-size:28px;opacity:0.3;display:block;margin-bottom:6px;"></i>No trucks are out on a trip right now.</div>');
            return;
        }
        if(!list.length) {
            $('#lfList').html('<div class="lf-empty">No trucks match this filter.</div>');
            return;
        }

        var html = '';
        $.each(list, function(_, t) {
            var unchecked = !!hidden[t.trip_id];
            html += '<div class="lf-item' + (unchecked ? ' unchecked' : '') + (focusedTrip == t.trip_id ? ' focused' : '') + (t.overdue ? ' late' : '') + '" data-trip="' + t.trip_id + '" style="--truck:' + t.color + '">'
                + '<input type="checkbox" class="lf-check" ' + (unchecked ? '' : 'checked') + ' title="Show this truck on the map">'
                + '<div class="lf-item-body">'
                +   '<div class="lf-item-top"><span class="lf-swatch"><i class="bi bi-truck"></i></span>'
                +     '<span class="lf-plate">' + esc(t.unit_label) + '</span>'
                +     '<button type="button" class="lf-only" title="Show only this truck"><i class="bi bi-eye"></i> Only</button></div>'
                +   '<div class="lf-headline"><i class="bi ' + t.statusIcon + '" style="color:' + t.statusColor + '"></i> ' + esc(t.plain.headline) + '</div>'
                +   (t.plain.detail ? '<div class="lf-detail' + (t.overdue ? ' late' : '') + '">' + esc(t.plain.detail) + '</div>' : '')
                +   '<div class="lf-meta"><i class="bi bi-person"></i> ' + esc(t.driver_name || 'No driver') + ' · ' + esc(t.customer_name || t.trip_code) + '</div>'
                +   '<div class="lf-prog-row"><div class="lf-prog"><div style="width:' + t.progress.percent + '%;background:' + t.color + '"></div></div>'
                +     '<span>' + t.progress.percent + '% done</span></div>'
                + '</div></div>';
        });
        $('#lfList').html(html);
    }

    // ==============================
    // MAP DRAWING
    // ==============================
    function truckPopup(t) {
        var a = t.analysis || {};
        var crew = esc(t.driver_name || '—') + (t.helper_name ? ' / ' + esc(t.helper_name) : '');
        return '<div class="lf-pop-head" style="background:' + t.color + '"><i class="bi bi-truck"></i> ' + esc(t.unit_label) + '</div>'
            + '<div class="lf-pop-status"><i class="bi ' + t.statusIcon + '" style="color:' + t.statusColor + '"></i> ' + esc(t.plain.headline) + '</div>'
            + (t.plain.detail ? '<div class="lf-pop-detail' + (t.overdue ? ' late' : '') + '">' + esc(t.plain.detail) + '</div>' : '')
            + '<div class="lf-pop-grid">'
            +   '<span>Customer</span><b>' + esc(t.customer_name || '—') + '</b>'
            +   '<span>Driver / Helper</span><b>' + crew + '</b>'
            +   '<span>Distance left</span><b>' + (a.remaining != null && t.plotted.length > 1 ? FleetTrack.formatDistance(a.remaining) : '—') + '</b>'
            +   '<span>Trip progress</span><b>' + t.progress.percent + '% done · ' + t.waypoints.length + ' stops</b>'
            +   (t.cargo_description ? '<span>Cargo</span><b>' + esc(t.cargo_description) + '</b>' : '')
            +   '<span>Trip no.</span><b>' + esc(t.trip_code) + '</b>'
            + '</div>'
            + '<a href="#" class="lf-pop-link" data-open-trip="' + t.trip_id + '" data-trip-code="' + esc(t.trip_code) + '"><i class="bi bi-box-arrow-up-right"></i> Open live tracking in Dispatch</a>';
    }

    // Screen-space heading (degrees clockwise from east) between two lat/lng points
    function heading(a, b) {
        var dx = (b[1] - a[1]) * Math.cos(a[0] * Math.PI / 180);
        var dy = b[0] - a[0];
        return Math.atan2(-dy, dx) * 180 / Math.PI;
    }

    function pathLength(path) {
        var total = 0;
        for(var i = 1; i < path.length; i++) total += L.latLng(path[i - 1]).distanceTo(L.latLng(path[i]));
        return total;
    }

    function addLine(rec, path, style) {
        var line = L.polyline(path, style).addTo(layer);
        rec.lines.push({ layer: line, base: style });
        return line;
    }

    function addMark(rec, marker) {
        marker.addTo(layer);
        rec.marks.push(marker);
        return marker;
    }

    // Direction arrows along a stretch of road still to be driven
    function addArrows(rec, path, color) {
        var len = pathLength(path);
        var count = Math.max(1, Math.min(6, Math.round(len / ARROW_EVERY_M)));
        for(var i = 1; i <= count; i++) {
            var f = i / (count + 1);
            var at = FleetTrack.splitPath(path, f).point;
            var ahead = FleetTrack.splitPath(path, Math.min(1, f + 0.01)).point;
            addMark(rec, L.marker(at, {
                interactive: false,
                icon: L.divIcon({
                    className: '',
                    html: '<div class="lf-arrow" style="color:' + color + ';transform:rotate(' + heading(at, ahead).toFixed(0) + 'deg)"><i class="bi bi-caret-right-fill"></i></div>',
                    iconSize: [16, 16], iconAnchor: [8, 8]
                })
            }));
        }
    }

    function drawTrip(t) {
        var color = t.color;
        var a = t.analysis;
        var rec = { lines: [], marks: [], bounds: L.latLngBounds([]), truck: null };
        var bind = function(l) {
            l.on('mouseover', function() { setHover(t.trip_id); });
            l.on('mouseout', function() { setHover(null); });
            l.on('click', function(e) { L.DomEvent.stopPropagation(e); focusTrip(t.trip_id, true); });
        };

        if(a) {
            $.each(a.segments, function(_, seg) {
                $.each(seg.path, function(_, p) { rec.bounds.extend(p); });
                if(seg.kind === 'done' || seg.kind === 'current-done') {
                    // Driven: dotted breadcrumb trail in the truck's color
                    bind(addLine(rec, seg.path, { color: color, weight: 4, opacity: 0.75, dashArray: '1 9', lineCap: 'round' }));
                } else {
                    // Ahead: white casing + solid truck-colored line, with direction arrows
                    addLine(rec, seg.path, { color: '#ffffff', weight: 9, opacity: 0.95, interactive: false });
                    bind(addLine(rec, seg.path, { color: color, weight: 5, opacity: seg.kind === 'pending' ? 0.6 : 1, dashArray: seg.dashed }));
                    addArrows(rec, seg.path, color);
                }
            });
        }

        // Stops: visited = filled with the truck color, upcoming = white with a truck-colored ring,
        // delivery destinations = flag pin in the truck color
        $.each(t.plotted, function(_, w) {
            var ll = [parseFloat(w.latitude), parseFloat(w.longitude)];
            rec.bounds.extend(ll);
            var st = FleetTrack.status(w);
            var visited = st !== 'PENDING';
            var tip = '<b>' + esc(t.unit_label) + '</b> — stop ' + esc(w.sequence) + ': ' + esc(w.waypoint_name)
                + '<br>' + (visited ? '✓ Already visited' : 'Not reached yet');
            var mark;
            if(w.waypoint_type === 'DELIVERY_DESTINATION') {
                mark = L.marker(ll, {
                    icon: L.divIcon({
                        className: '',
                        html: '<div class="lf-flag" style="background:' + color + '"><i class="bi bi-flag-fill"></i></div>',
                        iconSize: [24, 24], iconAnchor: [12, 24]
                    })
                });
            } else {
                mark = L.circleMarker(ll, {
                    radius: visited ? 5 : 6, weight: 3,
                    color: visited ? '#ffffff' : color,
                    fillColor: visited ? color : '#ffffff', fillOpacity: 1
                });
            }
            mark.bindTooltip(tip, { direction: 'top' });
            bind(addMark(rec, mark));
        });

        if(a && a.truckPos) {
            rec.bounds.extend(a.truckPos);
            var moving = t.progress.state === 'IN_TRANSIT';
            // Truck circle + a label card underneath: plate, then the status in words
            var marker = L.marker(a.truckPos, {
                zIndexOffset: moving ? 2000 : 1500,
                icon: L.divIcon({
                    className: '',
                    html: '<div class="lf-unit" style="--truck:' + color + '">'
                        + '<div class="lf-truck' + (moving ? ' moving' : '') + (t.overdue ? ' overdue' : '') + '"><i class="bi bi-truck"></i></div>'
                        + '<div class="lf-card' + (t.overdue ? ' late' : '') + '">'
                        +   '<div class="lf-card-plate">' + esc(t.unit_label) + '</div>'
                        +   '<div class="lf-card-status"><i class="bi ' + t.statusIcon + '" style="color:' + t.statusColor + '"></i> ' + esc(t.plain.headline) + '</div>'
                        +   (t.plain.detail ? '<div class="lf-card-detail">' + esc(t.plain.detail) + '</div>' : '')
                        + '</div></div>',
                    iconSize: [40, 40], iconAnchor: [20, 20], popupAnchor: [0, -22]
                })
            }).bindPopup(truckPopup(t), { maxWidth: 320 });
            rec.baseZ = moving ? 2000 : 1500;
            addMark(rec, marker);
            marker.on('mouseover', function() { setHover(t.trip_id); });
            marker.on('mouseout', function() { setHover(null); });
            marker.on('click', function() { focusTrip(t.trip_id, false); });
            marker.on('popupopen', function() { openPopupTrip = t.trip_id; });
            marker.on('popupclose', function() { if(openPopupTrip == t.trip_id) openPopupTrip = null; });
            rec.truck = marker;
        }
        tripDrawn[t.trip_id] = rec;
    }

    // ==============================
    // EMPHASIS (hover = transient, click = sticky focus)
    // ==============================
    function applyEmphasis() {
        var target = hoverTrip || focusedTrip;
        $.each(tripDrawn, function(id, rec) {
            var on = !target || id == target;
            $.each(rec.lines, function(_, l) {
                var s = $.extend({}, l.base);
                if(!on) s.opacity = (l.base.opacity == null ? 1 : l.base.opacity) * DIM_FACTOR;
                else if(target) s.weight = l.base.weight + 2;
                l.layer.setStyle(s);
            });
            $.each(rec.marks, function(_, m) {
                if(m.setOpacity) m.setOpacity(on ? 1 : 0.25);
                else if(m.setStyle) m.setStyle({ opacity: on ? 1 : 0.25, fillOpacity: on ? 1 : 0.25 });
            });
            if(rec.truck) rec.truck.setZIndexOffset(target && id == target ? 5000 : rec.baseZ);
        });
        // Bring the emphasized truck's lines above the others
        if(target && tripDrawn[target]) {
            $.each(tripDrawn[target].lines, function(_, l) { l.layer.bringToFront(); });
        }
        $('#lfList .lf-item').removeClass('hover').filter('[data-trip="' + hoverTrip + '"]').addClass('hover');
        declutter();
    }

    // ==============================
    // DECLUTTER: label cards must never cover each other (or another truck), and
    // must stay inside the map. Most important first — the hovered/focused truck,
    // late trucks, moving trucks — each card tries the spots below / above / right /
    // left of its truck at full size, then the same spots as plate-only, and only
    // hides as a last resort (its truck stays; hovering it brings the card back).
    // ==============================
    var CARD_SPOTS = ['', 'pos-above', 'pos-right', 'pos-left'];
    var CARD_SIZES = ['', 'compact'];
    function overlaps(a, b) {
        return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
    }

    function declutter() {
        var target = hoverTrip || focusedTrip;
        var items = [];
        $.each(tripDrawn, function(id, rec) {
            var el = rec.truck && rec.truck.getElement();
            if(!el) return;
            var t = tripById(id);
            items.push({
                id: id,
                card: el.querySelector('.lf-card'),
                circle: el.querySelector('.lf-truck'),
                rank: (id == target ? 0 : t && t.overdue ? 1 : t && t.progress.state === 'IN_TRANSIT' ? 2 : 3)
            });
        });
        items.sort(function(a, b) { return a.rank - b.rank; });

        var mapRect = map.getContainer().getBoundingClientRect();
        var circles = items.map(function(it) { return { id: it.id, rect: it.circle.getBoundingClientRect() }; });
        var placed = [];
        var collides = function(it) {
            var r = it.card.getBoundingClientRect();
            if(r.left < mapRect.left || r.right > mapRect.right || r.top < mapRect.top || r.bottom > mapRect.bottom) return true;
            if(placed.some(function(p) { return overlaps(r, p); })) return true;
            return circles.some(function(c) { return c.id !== it.id && overlaps(r, c.rect); });
        };
        var setLayout = function(card, size, spot) {
            card.classList.remove('compact', 'hidden', 'pos-above', 'pos-right', 'pos-left');
            if(size) card.classList.add(size);
            if(spot) card.classList.add(spot);
        };

        $.each(items, function(_, it) {
            var fits = false;
            for(var s = 0; s < CARD_SIZES.length && !fits; s++) {
                for(var p = 0; p < CARD_SPOTS.length && !fits; p++) {
                    setLayout(it.card, CARD_SIZES[s], CARD_SPOTS[p]);
                    // The emphasized truck always gets its full card in the first spot that fits
                    fits = !collides(it);
                }
            }
            if(!fits) {
                if(it.rank === 0) setLayout(it.card, '', ''); // emphasized: show anyway, on top
                else { setLayout(it.card, 'hidden', ''); return; }
            }
            placed.push(it.card.getBoundingClientRect());
        });
    }

    function setHover(id) {
        if(hoverTrip == id) return;
        hoverTrip = id;
        applyEmphasis();
    }

    function renderFocusPill() {
        var t = focusedTrip ? tripById(focusedTrip) : null;
        if(t) {
            $('#lfFocusPill').html('<span class="lf-focus-dot" style="background:' + t.color + '"></span>Showing <b>' + esc(t.unit_label) + '</b> route'
                + ' <button type="button" id="lfFocusClear" title="Show all trucks equally"><i class="bi bi-x-lg"></i></button>').show();
        } else {
            $('#lfFocusPill').hide();
        }
    }

    // zoomToRoute: fit the whole route (row/route click). The truck popup opens only from a
    // marker click (Leaflet's own popup binding) — auto-panning to it would hide part of the route.
    function focusTrip(id, zoomToRoute) {
        if(hidden[id]) { delete hidden[id]; saveHidden(); renderList(); renderMap(); }
        focusedTrip = id;
        $('#lfList .lf-item').removeClass('focused').filter('[data-trip="' + id + '"]').addClass('focused');
        applyEmphasis();
        renderFocusPill();
        var rec = tripDrawn[id];
        if(rec && zoomToRoute && rec.bounds.isValid()) map.fitBounds(rec.bounds.pad(0.12), { maxZoom: 13 });
    }

    function clearFocus() {
        focusedTrip = null;
        $('#lfList .lf-item').removeClass('focused');
        applyEmphasis();
        renderFocusPill();
    }

    function shownBounds() {
        var b = L.latLngBounds([]);
        $.each(trips, function(_, t) {
            if(!isShown(t)) return;
            $.each(t.plotted, function(_, w) { b.extend([parseFloat(w.latitude), parseFloat(w.longitude)]); });
            if(t.analysis && t.analysis.truckPos) b.extend(t.analysis.truckPos);
        });
        return b.isValid() ? b : null;
    }

    function fitShown() {
        var b = shownBounds();
        if(b) map.fitBounds(b.pad(0.08), { maxZoom: 13 });
    }

    function renderMap() {
        if(!map) return;
        var reopen = openPopupTrip;
        layer.clearLayers();
        tripDrawn = {};

        var shown = trips.filter(isShown);
        $.each(shown, function(_, t) { drawTrip(t); });
        if(focusedTrip && !tripDrawn[focusedTrip]) focusedTrip = null; // focused truck was filtered out
        if(hoverTrip && !tripDrawn[hoverTrip]) hoverTrip = null;
        applyEmphasis();
        renderFocusPill();

        var unpinned = shown.filter(function(t) { return !t.plotted.length; }).length;
        if(!trips.length) setMapStatus('No trucks are out on a trip right now.');
        else if(!shown.length) setMapStatus('No trucks selected — tick trucks in the list to show them.');
        else if(unpinned) setMapStatus(unpinned + ' selected truck' + (unpinned > 1 ? 's have' : ' has') + ' no pinned waypoints — pin them in Trips → Manage Route.');
        else setMapStatus('');

        if(reopen && tripDrawn[reopen] && tripDrawn[reopen].truck) {
            tripDrawn[reopen].truck.openPopup();
        }
    }

    function renderAll() {
        $.each(trips, function(_, t) { enrich(t); });
        $('#lfOnRoad').text(trips.length + ' on the road');
        renderSummary();
        renderChips();
        renderList();
        renderMap();
    }

    // ==============================
    // DATA
    // ==============================
    // Road routes one trip at a time, so the public routing server isn't flooded.
    // FleetTrack caches by stop coordinates, so after the first load this is instant
    // (and a trip whose stops were edited gets a fresh route automatically).
    function loadRoutes() {
        var routable = trips.filter(function(t) { return t.plotted.length > 1; });
        var done = 0;
        var showProgress = !fittedOnce;
        if(showProgress && routable.length) setMapStatus('Calculating road routes… (0/' + routable.length + ')');
        var next = {};
        return routable.reduce(function(chain, t) {
            return chain.then(function() {
                return FleetTrack.fetchRoute(t.plotted).then(function(route) {
                    next[t.trip_id] = route;
                    done++;
                    if(showProgress) setMapStatus('Calculating road routes… (' + done + '/' + routable.length + ')');
                });
            });
        }, Promise.resolve()).then(function() {
            routes = next;
        });
    }

    function refresh() {
        $('#lfRefreshBtn i').addClass('spin');
        return fetch(feedUrl, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
            .then(function(res) { return res.json(); })
            .then(function(data) {
                if(!data || data.status !== 'success') throw new Error((data && data.message) || 'Feed error');
                FleetTrack.syncClock(data.server_time);
                trips = data.trips || [];

                if(!fittedOnce) renderAll(); // first load: show the list right away while routes are calculated
                $.each(trips, function(_, t) { t.plotted = FleetTrack.plottedOf(t.waypoints || []); });
                return loadRoutes().then(function() {
                    renderAll();
                    if(!fittedOnce) { fitShown(); fittedOnce = true; }
                });
            })
            .then(function() {
                $('#lfUpdated').text('· updated ' + FleetTrack.formatTime(new Date(FleetTrack.now())));
            })
            .catch(function(err) {
                setMapStatus('Could not load the fleet: ' + err.message);
            })
            .finally(function() {
                $('#lfRefreshBtn i').removeClass('spin');
            });
    }

    // ==============================
    // EVENTS
    // ==============================
    function bindEvents() {
        $('#lfChips').on('click', '.lf-chip', function() {
            phaseFilter = $(this).attr('data-phase');
            renderChips(); renderList(); renderMap(); fitShown();
        });

        $('#lfSearch').on('input', function() {
            searchText = $.trim(this.value).toLowerCase();
            renderList(); renderMap();
        });

        $('#lfList').on('change', '.lf-check', function() {
            var id = $(this).closest('.lf-item').attr('data-trip');
            if(this.checked) delete hidden[id]; else hidden[id] = true;
            saveHidden();
            renderList(); renderMap();
        });
        $('#lfList').on('click', '.lf-check', function(e) { e.stopPropagation(); });

        // Eye button: show only this truck
        $('#lfList').on('click', '.lf-only', function(e) {
            e.stopPropagation();
            var id = $(this).closest('.lf-item').attr('data-trip');
            $.each(trips, function(_, t) { if(t.trip_id != id) hidden[t.trip_id] = true; });
            delete hidden[id];
            saveHidden();
            renderList(); renderMap();
            focusTrip(id, true);
        });

        // Row hover previews the route; row click focuses it and zooms to the whole route
        $('#lfList').on('mouseenter', '.lf-item', function() { setHover($(this).attr('data-trip')); });
        $('#lfList').on('mouseleave', '.lf-item', function() { setHover(null); });
        $('#lfList').on('click', '.lf-item', function() {
            var id = $(this).attr('data-trip');
            if(focusedTrip == id) { clearFocus(); return; } // second click releases the focus
            focusTrip(id, true);
        });

        $('#lfSelectAll').on('click', function(e) {
            e.preventDefault();
            $.each(trips, function(_, t) { if(matchesFilters(t)) delete hidden[t.trip_id]; });
            saveHidden(); renderList(); renderMap(); fitShown();
        });
        $('#lfSelectNone').on('click', function(e) {
            e.preventDefault();
            $.each(trips, function(_, t) { if(matchesFilters(t)) hidden[t.trip_id] = true; });
            saveHidden(); renderList(); renderMap();
        });

        $('#lfFitBtn').on('click', fitShown);
        $('#lfRefreshBtn').on('click', refresh);
        $('#lfFocusPill').on('click', '#lfFocusClear', function(e) { e.stopPropagation(); clearFocus(); fitShown(); });

        // Clicking empty map releases the focus
        map.on('click', function() { if(focusedTrip) clearFocus(); });
        // Labels' screen spacing changes with zoom
        map.on('zoomend', declutter);

        // Big screen: the whole widget fills the monitor (for a wall TV / older eyes)
        $('#lfBigBtn').on('click', function() {
            var el = document.getElementById('liveFleet');
            if(document.fullscreenElement) document.exitFullscreen();
            else if(el.requestFullscreen) el.requestFullscreen();
        });
        document.addEventListener('fullscreenchange', function() {
            var big = document.fullscreenElement === document.getElementById('liveFleet');
            $('#lfBigBtn').html(big ? '<i class="bi bi-fullscreen-exit"></i> Exit big screen' : '<i class="bi bi-arrows-fullscreen"></i> Big screen');
            setTimeout(function() { map.invalidateSize(); fitShown(); declutter(); }, 200);
        });

        // Popup link → Dispatch page, which reopens Live Tracking for this trip (see dispatch.js)
        $('#lfMap').on('click', '[data-open-trip]', function(e) {
            e.preventDefault();
            try {
                sessionStorage.setItem('dispatch_reopen_tracking', JSON.stringify({
                    trip_id: $(this).attr('data-open-trip'),
                    trip_code: $(this).attr('data-trip-code')
                }));
            } catch(err) { /* storage blocked: opens Dispatch without the modal */ }
            window.location.href = dispatchUrl;
        });
    }

    function init() {
        $root = $('#liveFleet');
        if(!$root.length) return;
        esc = FleetTrack.esc;
        feedUrl = $root.attr('data-feed-url');
        dispatchUrl = $root.attr('data-dispatch-url');

        if(typeof L === 'undefined') {
            $('#lfList').html('<div class="lf-empty text-danger">Map library failed to load — check your internet connection.</div>');
            return;
        }
        loadHidden();
        map = L.map('lfMap').setView([15.6, 121.0], 7); // Luzon
        map.attributionControl.setPrefix(false); // OSM credit must stay (ODbL / tile usage policy)
        FleetTrack.osmTiles().addTo(map);
        layer = L.layerGroup().addTo(map);

        bindEvents();
        refresh();
        setInterval(refresh, POLL_MS);
        setInterval(function() {
            if(trips.some(function(t) { return t.progress && t.progress.state === 'IN_TRANSIT'; })) renderAll();
        }, TICK_MS);
    }

    // jQuery (vendor bundle) loads in the page footer, after this script
    window.addEventListener('load', init);
})();
