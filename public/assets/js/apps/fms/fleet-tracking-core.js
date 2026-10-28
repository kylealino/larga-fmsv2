// =============================================
// FLEET TRACKING CORE — shared by Dispatch → Live Tracking and the
// dashboard's Live Fleet Tracking map.
//
// There is no GPS feed: a truck's position is derived from the recorded
// waypoint arrival/departure times. While a leg is in transit the truck is
// interpolated along the road by elapsed time vs. the leg's planned duration
// (next stop's expected arrival if set, else the OSRM drive time).
// Road geometry comes from the public OSRM server; if that is unavailable the
// legs fall back to straight lines.
// Requires Leaflet (L) and jQuery ($).
// =============================================
var FleetTrack = (function() {
    var routeCache = {}; // coords key -> { legs: [{path, distance, duration}], straight: false }
    var clockOffsetMs = 0; // server clock minus browser clock

    var STATUS_COLORS = { 'PENDING': '#94a3b8', 'ARRIVED': '#0ea5e9', 'DEPARTED': '#f59e0b', 'COMPLETED': '#10b981' };
    var TYPE_LABELS = {
        'GARAGE': 'Garage',
        'EMPTY_CONTAINER_PICKUP': 'Empty Container Pickup',
        'CLIENT_WAREHOUSE': 'Client Warehouse',
        'DELIVERY_DESTINATION': 'Delivery Destination',
        'PORT_TERMINAL': 'Port / Terminal',
        'RETURN_POINT': 'Return Point',
        'PICKUP_LOCATION': 'Pickup Location',
        'OTHER': 'Other'
    };
    var DELIVERY_TYPES = ['DELIVERY_DESTINATION', 'CLIENT_WAREHOUSE'];
    var MAX_TRANSIT_FRACTION = 0.97; // an overdue truck waits just short of the next stop

    function esc(value) {
        return $('<div>').text(value == null ? '' : String(value)).html();
    }

    function hasCoords(row) {
        return row.latitude !== null && row.latitude !== '' && row.longitude !== null && row.longitude !== ''
            && !isNaN(parseFloat(row.latitude)) && !isNaN(parseFloat(row.longitude));
    }

    function status(row) {
        return row.waypoint_status ? row.waypoint_status : 'PENDING';
    }

    function parseDate(value) {
        if(!value) return null;
        var d = new Date(String(value).replace(' ', 'T'));
        return isNaN(d.getTime()) ? null : d;
    }

    // Align "now" with the server's clock (the clock the waypoint times are recorded against)
    function syncClock(serverTime) {
        var server = parseDate(serverTime);
        if(server) clockOffsetMs = server.getTime() - Date.now();
    }

    function now() {
        return Date.now() + clockOffsetMs;
    }

    function formatDistance(meters) {
        return meters >= 1000 ? (meters / 1000).toFixed(1) + ' km' : Math.round(meters) + ' m';
    }

    function formatTime(date) {
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    }

    function stopName(row) {
        return '#' + row.sequence + ' ' + (row.waypoint_name || '');
    }

    // Where the trip is along its waypoints (by sequence), from recorded statuses alone.
    //   state: NOT_STARTED | AT_STOP | IN_TRANSIT | COMPLETED
    //   phase: AWAITING | IN_TRANSIT | AT_STOP | RETURNING | COMPLETED  (for filters/colors)
    function computeProgress(waypoints) {
        var lastIdx = -1;
        $.each(waypoints, function(i, row) {
            if(status(row) !== 'PENDING') lastIdx = i;
        });
        var p = { lastIdx: lastIdx, state: 'NOT_STARTED', currentIdx: 0, nextIdx: waypoints.length ? 0 : -1 };

        if(lastIdx >= 0) {
            var st = status(waypoints[lastIdx]);
            p.currentIdx = lastIdx;
            if(st === 'COMPLETED' && lastIdx === waypoints.length - 1) {
                p.state = 'COMPLETED'; p.nextIdx = -1;
            } else if(st === 'DEPARTED' && lastIdx < waypoints.length - 1) {
                p.state = 'IN_TRANSIT'; p.nextIdx = lastIdx + 1;
            } else {
                p.state = 'AT_STOP'; p.nextIdx = lastIdx < waypoints.length - 1 ? lastIdx + 1 : -1;
            }
        }

        // Returning = every delivery stop is behind the truck and it's heading back
        var deliveredAll = false;
        var hasDelivery = false;
        $.each(waypoints, function(i, row) {
            if(DELIVERY_TYPES.indexOf(row.waypoint_type) !== -1) {
                hasDelivery = true;
                deliveredAll = (status(row) === 'DEPARTED' || status(row) === 'COMPLETED');
            }
        });
        if(p.state === 'NOT_STARTED') p.phase = 'AWAITING';
        else if(p.state === 'COMPLETED') p.phase = 'COMPLETED';
        else if(p.state === 'IN_TRANSIT' && hasDelivery && deliveredAll) p.phase = 'RETURNING';
        else p.phase = p.state;

        var total = waypoints.length;
        var done = waypoints.filter(function(r) { var s = status(r); return s === 'DEPARTED' || s === 'COMPLETED'; }).length;
        if(p.state === 'AT_STOP') done += 0.5; // halfway credit for the stop the truck is sitting at
        p.percent = p.state === 'COMPLETED' ? 100 : (total ? Math.min(100, Math.round(done / total * 100)) : 0);
        return p;
    }

    // Headline + sub-line describing where the truck is
    function describe(waypoints, progress) {
        if(!waypoints.length) return { title: 'No route waypoints', sub: 'Add waypoints in Trips → Manage Route.' };
        var cur = waypoints[progress.currentIdx];
        var next = progress.nextIdx >= 0 ? waypoints[progress.nextIdx] : null;

        if(progress.state === 'NOT_STARTED') {
            var dep = parseDate(cur.expected_departure);
            return { title: 'Awaiting departure', sub: 'Starting at ' + stopName(cur) + (dep ? ' · planned ' + formatTime(dep) : '') };
        }
        if(progress.state === 'AT_STOP') {
            var at = parseDate(cur.actual_arrival);
            return { title: 'At ' + stopName(cur), sub: (at ? 'Arrived ' + formatTime(at) : 'Arrived') + (next ? ' · next: ' + stopName(next) : '') };
        }
        if(progress.state === 'IN_TRANSIT') {
            var left = parseDate(cur.actual_departure);
            return {
                title: (progress.phase === 'RETURNING' ? 'Returning to ' : 'In transit to ') + stopName(next),
                sub: 'Departed ' + stopName(cur) + (left ? ' at ' + formatTime(left) : '')
            };
        }
        return { title: 'Trip completed', sub: 'Arrived at final stop ' + stopName(cur) };
    }

    // Split a path at a fraction of its length -> { point, done: [...], left: [...] }
    function splitPath(path, fraction) {
        var total = 0, seg = [];
        for(var i = 1; i < path.length; i++) {
            var d = L.latLng(path[i - 1]).distanceTo(L.latLng(path[i]));
            seg.push(d); total += d;
        }
        var target = total * fraction, run = 0;
        for(var j = 0; j < seg.length; j++) {
            if(run + seg[j] >= target) {
                var t = seg[j] ? (target - run) / seg[j] : 0;
                var a = path[j], b = path[j + 1];
                var pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
                return { point: pt, done: path.slice(0, j + 1).concat([pt]), left: [pt].concat(path.slice(j + 1)) };
            }
            run += seg[j];
        }
        var last = path[path.length - 1];
        return { point: last, done: path.slice(), left: [last] };
    }

    function plottedOf(waypoints) {
        var plotted = [];
        $.each(waypoints, function(i, row) {
            if(hasCoords(row)) plotted.push($.extend({ _idx: i }, row));
        });
        return plotted;
    }

    function fetchRoute(plotted) {
        var key = plotted.map(function(r) { return parseFloat(r.longitude).toFixed(6) + ',' + parseFloat(r.latitude).toFixed(6); }).join(';');
        if(routeCache[key]) return Promise.resolve(routeCache[key]);
        if(plotted.length < 2) return Promise.resolve({ legs: [], straight: false });

        var straight = function() {
            var legs = [];
            for(var i = 0; i < plotted.length - 1; i++) {
                var a = [parseFloat(plotted[i].latitude), parseFloat(plotted[i].longitude)];
                var b = [parseFloat(plotted[i + 1].latitude), parseFloat(plotted[i + 1].longitude)];
                legs.push({ path: [a, b], distance: L.latLng(a).distanceTo(L.latLng(b)), duration: null });
            }
            return { legs: legs, straight: true };
        };

        return fetch('https://router.project-osrm.org/route/v1/driving/' + key + '?overview=false&steps=true&geometries=geojson')
            .then(function(res) { return res.json(); })
            .then(function(data) {
                if(!data || data.code !== 'Ok' || !data.routes || !data.routes.length) throw new Error('no route');
                var legs = data.routes[0].legs.map(function(leg) {
                    var path = [];
                    $.each(leg.steps, function(_, step) {
                        $.each(step.geometry.coordinates, function(_, c) { path.push([c[1], c[0]]); });
                    });
                    return { path: path.length > 1 ? path : [], distance: leg.distance, duration: leg.duration };
                });
                var result = { legs: legs, straight: false };
                routeCache[key] = result;
                return result;
            })
            .catch(function() { return straight(); }); // not cached, so a later refresh retries road routing
    }

    // Combine statuses + road route into what to draw:
    //   segments: [{ path, kind: 'done' | 'current-done' | 'current-left' | 'pending', dashed }]
    //   truckPos, truckLabel, remaining (m), nextEta (Date|null)
    function analyze(waypoints, plotted, route, progress) {
        var out = { segments: [], truckPos: null, truckLabel: '', remaining: 0, nextEta: null };
        var cur = waypoints[progress.currentIdx];
        var dashed = route.straight ? '8 8' : null;

        $.each(route.legs, function(i, leg) {
            if(!leg.path.length) return;
            var a = plotted[i]._idx, b = plotted[i + 1]._idx;

            if(progress.state === 'COMPLETED' || b <= progress.lastIdx) {
                out.segments.push({ path: leg.path, kind: 'done', dashed: dashed });
            } else if(progress.state === 'IN_TRANSIT' && a <= progress.currentIdx && b > progress.currentIdx) {
                var dep = parseDate(cur.actual_departure);
                var nextRow = waypoints[progress.nextIdx];
                var plannedArr = parseDate(nextRow.expected_arrival);
                var durMs = (plannedArr && dep && plannedArr > dep) ? (plannedArr - dep) : (leg.duration ? leg.duration * 1000 : null);
                var fraction = (dep && durMs) ? Math.max(0, Math.min(MAX_TRANSIT_FRACTION, (now() - dep) / durMs)) : 0.05;
                var split = splitPath(leg.path, fraction);

                out.segments.push({ path: split.done, kind: 'current-done', dashed: dashed });
                out.segments.push({ path: split.left, kind: 'current-left', dashed: dashed });
                out.truckPos = split.point;
                out.remaining += leg.distance * (1 - fraction);
                if(dep && durMs) out.nextEta = new Date(dep.getTime() + durMs);
                out.truckLabel = (progress.phase === 'RETURNING' ? 'Returning to ' : 'In transit to ') + stopName(nextRow)
                    + (fraction >= MAX_TRANSIT_FRACTION ? ' (past planned arrival)' : ' · ~' + Math.round(fraction * 100) + '% of leg');
                out.overdue = fraction >= MAX_TRANSIT_FRACTION;
            } else {
                out.segments.push({ path: leg.path, kind: 'pending', dashed: dashed });
                out.remaining += leg.distance;
            }
        });

        // Truck parked at a stop (not started / at stop / completed)
        if(!out.truckPos) {
            var park = waypoints[progress.currentIdx];
            if(park && hasCoords(park)) {
                out.truckPos = [parseFloat(park.latitude), parseFloat(park.longitude)];
            } else {
                // Current stop not pinned: park at the last pinned stop at/before it
                for(var k = plotted.length - 1; k >= 0; k--) {
                    if(plotted[k]._idx <= progress.currentIdx) { out.truckPos = [parseFloat(plotted[k].latitude), parseFloat(plotted[k].longitude)]; break; }
                }
                if(!out.truckPos && plotted.length) out.truckPos = [parseFloat(plotted[0].latitude), parseFloat(plotted[0].longitude)];
            }
            out.truckLabel = describe(waypoints, progress).title;
            if(progress.state !== 'COMPLETED' && progress.nextIdx >= 0) {
                var ea = parseDate(waypoints[progress.nextIdx].expected_arrival);
                if(ea) out.nextEta = ea;
            }
        }
        if(progress.state === 'COMPLETED') out.remaining = 0;
        return out;
    }

    // Standard Leaflet styling for a segment kind; `color` overrides the route blue (dashboard per-truck colors)
    function drawSegment(layer, seg, color) {
        var styles = {
            'done':         [{ color: '#059669', weight: 8, opacity: 0.9 }, { color: '#34d399', weight: 5, opacity: 1 }],
            'current-done': [{ color: '#059669', weight: 8, opacity: 0.9 }, { color: '#34d399', weight: 5, opacity: 1 }],
            'current-left': [{ color: '#1a56c4', weight: 8, opacity: 0.9 }, { color: color || '#4f8ff7', weight: 5, opacity: 1 }],
            'pending':      [{ color: '#1a56c4', weight: 8, opacity: 0.35 }, { color: color || '#4f8ff7', weight: 5, opacity: 0.55 }]
        }[seg.kind];
        $.each(styles, function(_, s) {
            L.polyline(seg.path, $.extend({ dashArray: seg.dashed }, s)).addTo(layer);
        });
    }

    function pinIcon(label, color) {
        return L.divIcon({
            className: '',
            html: '<div class="lt-pin" style="background:' + color + ';"><span>' + label + '</span></div>',
            iconSize: [30, 30], iconAnchor: [15, 30], popupAnchor: [0, -30]
        });
    }

    function osmTiles() {
        return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '<a href="https://www.openstreetmap.org/copyright" target="_blank">&copy; OpenStreetMap</a>'
        });
    }

    return {
        STATUS_COLORS: STATUS_COLORS,
        TYPE_LABELS: TYPE_LABELS,
        DEFAULT_CENTER: [14.5995, 120.9842], // Metro Manila
        esc: esc,
        hasCoords: hasCoords,
        status: status,
        parseDate: parseDate,
        syncClock: syncClock,
        now: now,
        formatDistance: formatDistance,
        formatTime: formatTime,
        stopName: stopName,
        computeProgress: computeProgress,
        describe: describe,
        splitPath: splitPath,
        plottedOf: plottedOf,
        fetchRoute: fetchRoute,
        analyze: analyze,
        drawSegment: drawSegment,
        pinIcon: pinIcon,
        osmTiles: osmTiles
    };
})();
