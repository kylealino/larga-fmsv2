<?php

namespace App\Controllers;

class MyAdminDashboard extends BaseController
{
    public function __construct(){
		$this->request = \Config\Services::request();
        $this->db = \Config\Database::connect();
        $this->session = session();
        $this->cuser = $this->session->get('__xsys_myuserzicas__');
	}

    public function index(){
        if (!session('__xsys_myuserzicas_is_logged__')) {
            return view('MyLogin-admin');
        }
        return view('MyAdminDashboard');
    }

    // Live fleet map feed (polled by the dashboard's Live Fleet Tracking widget)
    public function liveFleet(){
        helper('permission');
        if (!widget_visible('live_fleet_map')) {
            return $this->response->setStatusCode(403)->setJSON(['status' => 'error', 'message' => 'Live fleet map is not enabled for your role.']);
        }
        $dashboardModel = model('App\Models\FMS_Dashboard_Model');
        return $this->response->setJSON([
            'status'      => 'success',
            // DB clock, the same clock the waypoint times are recorded against — the
            // browser uses it to correct for a client PC whose clock is off
            'server_time' => $this->db->query("SELECT NOW() AS now")->getRow()->now,
            'trips'       => $dashboardModel->getLiveFleet(),
        ]);
    }

}
