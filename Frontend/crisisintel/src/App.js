import './App.css';
import './ui.css';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import SignInPage from './loginpages/SignInPage';
import Register from './pages/Register';
import Feed from './pages/Feed';
import Posts from './pages/Posts';
import Search from './pages/Search';
import NavBar from './components/NavBar';
import Toast from './components/Toast';
import RequireAuth from './components/RequireAuth';
import FireTeams from './components/FireTeams';
import UserProfile from './pages/UserProfile';
import DoctorProfile from './pages/DoctorProfile';
import HospitalProfile from './pages/HospitalProfile';
import PostDetail from './pages/PostDetail';
import FireDepartmentProfile from './pages/FireDepartmentProfile';
import FireRequestDetail from './pages/FireRequestDetail';
import Inbox from './pages/Inbox';
import Notifications from './pages/Notifications';
import HospitalDoctorsManage from './pages/HospitalDoctorsManage';
import HospitalServices from './pages/HospitalServices';
import MyAppointments from './pages/MyAppointments';
import DoctorAppointments from './pages/DoctorAppointments';
import HospitalServiceBookings from './pages/HospitalServiceBookings';
import BloodBankStaff from './pages/BloodBankStaff';
import BloodInventory from './pages/BloodInventory';
import BloodBankDonors from './pages/BloodBankDonors';
import RecruitManage from './pages/RecruitManage';
import RecruitBrowse from './pages/RecruitBrowse';
import BloodBankRequests from './pages/BloodBankRequests';
import DonorRequests from './pages/DonorRequests';
import SocialOrg from './pages/SocialOrg';
import OrgVolunteers from './pages/OrgVolunteers';
import Campaigns from './pages/Campaigns';
import CampaignDetail from './pages/CampaignDetail';
import Donations from './pages/Donations';
import MyCampaigns from './pages/MyCampaigns';
import Admin from './pages/Admin';
import CrisisList from './pages/CrisisList';
import CrisisNew from './pages/CrisisNew';
import CrisisDetail from './pages/CrisisDetail';
import CrisisInvitations from './pages/CrisisInvitations';
import FireDeployments from './pages/FireDeployments';
import AIChatbot from './components/AIChatbot';

function App() {
  return (
    <BrowserRouter>
      <NavBar />
      <div className="px-8 py-6 bg-gray-100 min-h-screen">
        <div className="max-w-7xl mx-auto">
          {/* Top-level Fire Teams link removed; accessible via NavBar button for fire service users */}
          <Routes>
            <Route path="/" element={<SignInPage />} />
            <Route path="/register" element={<Register />} />
            <Route path="/feed" element={<RequireAuth><Feed /></RequireAuth>} />
            <Route path="/posts" element={<RequireAuth><Posts /></RequireAuth>} />
            <Route path="/search" element={<RequireAuth><Search /></RequireAuth>} />
            <Route path="/fire-teams" element={<RequireAuth><FireTeams /></RequireAuth>} />
            <Route path="/users/:id" element={<RequireAuth><UserProfile /></RequireAuth>} />
            <Route path="/doctors/:id" element={<RequireAuth><DoctorProfile /></RequireAuth>} />
            <Route path="/hospitals/:id" element={<RequireAuth><HospitalProfile /></RequireAuth>} />
            <Route path="/posts/:id" element={<RequireAuth><PostDetail /></RequireAuth>} />
            <Route path="/fire-departments/:id" element={<RequireAuth><FireDepartmentProfile /></RequireAuth>} />
            <Route path="/fire/requests/:id" element={<RequireAuth><FireRequestDetail /></RequireAuth>} />
            <Route path="/inbox" element={<RequireAuth><Inbox /></RequireAuth>} />
            <Route path="/notifications" element={<RequireAuth><Notifications /></RequireAuth>} />
            <Route path="/fire/deployments" element={<RequireAuth><FireDeployments /></RequireAuth>} />
            <Route path="/hospitals/:id/doctors/manage" element={<RequireAuth><HospitalDoctorsManage /></RequireAuth>} />
            <Route path="/hospitals/:id/services" element={<RequireAuth><HospitalServices /></RequireAuth>} />
            {/* Back-compat legacy routes for hospital managers */}
            <Route path="/hospital/doctors" element={<RequireAuth><HospitalDoctorsManage /></RequireAuth>} />
            <Route path="/hospital/services" element={<RequireAuth><HospitalServices /></RequireAuth>} />
            <Route path="/hospital/service-bookings" element={<RequireAuth><HospitalServiceBookings /></RequireAuth>} />
            <Route path="/appointments/mine" element={<RequireAuth><MyAppointments /></RequireAuth>} />
            <Route path="/appointments/doctor" element={<RequireAuth><DoctorAppointments /></RequireAuth>} />
            {/* Blood bank management */}
            <Route path="/blood-bank/donors" element={<RequireAuth><BloodBankDonors /></RequireAuth>} />
            <Route path="/blood-bank/staff" element={<RequireAuth><BloodBankStaff /></RequireAuth>} />
            <Route path="/blood-bank/inventory" element={<RequireAuth><BloodInventory /></RequireAuth>} />
            <Route path="/blood-bank/recruit" element={<RequireAuth><RecruitManage /></RequireAuth>} />
            <Route path="/blood-bank/requests" element={<RequireAuth><BloodBankRequests /></RequireAuth>} />
            <Route path="/donor/requests" element={<RequireAuth><DonorRequests /></RequireAuth>} />
            {/* Public recruit browse/apply (requires login to apply) */}
            <Route path="/recruit" element={<RequireAuth><RecruitBrowse /></RequireAuth>} />
            {/* Social Organizations */}
            <Route path="/social-org" element={<RequireAuth><SocialOrg /></RequireAuth>} />
            <Route path="/social-org/volunteers" element={<RequireAuth><OrgVolunteers /></RequireAuth>} />
            <Route path="/social-org/campaigns" element={<RequireAuth><Campaigns /></RequireAuth>} />
            <Route path="/campaigns/:id" element={<RequireAuth><CampaignDetail /></RequireAuth>} />
            <Route path="/social-org/donations" element={<RequireAuth><Donations /></RequireAuth>} />
            <Route path="/my-campaigns" element={<RequireAuth><MyCampaigns /></RequireAuth>} />
            {/* Admin */}
            <Route path="/admin" element={<RequireAuth><Admin /></RequireAuth>} />
            {/* Crisis Management */}
            <Route path="/crises" element={<RequireAuth><CrisisList /></RequireAuth>} />
            <Route path="/crises/new" element={<RequireAuth><CrisisNew /></RequireAuth>} />
            <Route path="/crises/:id" element={<RequireAuth><CrisisDetail /></RequireAuth>} />
            <Route path="/crises/invitations" element={<RequireAuth><CrisisInvitations /></RequireAuth>} />
          </Routes>
        </div>
      </div>
      <Toast />
      <AIChatbot />
    </BrowserRouter>
  );
}

export default App;

