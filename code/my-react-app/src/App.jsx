import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import './App.css';
import Login from './Login.jsx';
import Signup from './Signup.jsx';
import ForgotPassword from './forgotPassword.jsx';
import OtpVerify from './otpVerify.jsx'
import Admin from './adminDashboard.jsx'
import Student from './studentDashboard.jsx'
import Teacher from './teacherDashboard.jsx'
import TeacherProfile from './teacherProfile';
import CourseProfile from './courseProfile.jsx';
import StudentCourseProfile from './studentCourseProfile.jsx';
import ScheduleForm from './scheduleForm.jsx';
import UpdateForm from './updateForm.jsx';
import Chat from './chatPage.jsx';
import MeetingRoom from './MeetingRoom.jsx';
import StudentQuizzes from './StudentQuizzes.jsx';
import QuizTake from './QuizTake.jsx';
import LectureRecap from './LectureRecap.jsx';
import Material from './Material.jsx';
import UploadMaterial from './UploadMaterial.jsx';
import ManageMeeting from './manageMeeting.jsx';
import ViewAttendance from './viewAttendance.jsx';
import ManageEnrollment from './manageEnrollment.jsx';
import '@fortawesome/fontawesome-free/css/all.min.css';
import StudentChat from './studentChat.jsx';
import StudentProfile from './studentProfile.jsx';
import AdminDashboard from './adminDashboard.jsx';

function App() {
  return (
    <Router>
      <div className='app-container'>
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/ForgotPassword" element={<ForgotPassword />} />
          <Route path="/otpVerify" element={<OtpVerify />} />
          <Route path="/adminDashboard" element={<Admin />} />
          <Route path="/studentDashboard" element={<Student />} />
          <Route path="/teacherDashboard" element={<Teacher />} />
          <Route path="/teacherProfile/:teacherId?" element={<TeacherProfile />} />
          <Route path="/courseProfile" element={<CourseProfile />} />
          <Route path="/studentCourseProfile" element={<StudentCourseProfile />} />
          <Route path="/scheduleForm" element={<ScheduleForm />} />
          <Route path="/updateForm" element={<UpdateForm />} />
          <Route path="/manageMeeting" element={<ManageMeeting />} />
          <Route path="/manageEnrollment" element={<ManageEnrollment />} />
          <Route path="/attendance/:sessionId" element={<ViewAttendance />} />
          <Route path="/chatPage" element={<Chat />} />
          <Route path="/meeting/:meetingId" element={<MeetingRoom />} />
          <Route path="/studentQuizzes" element={<StudentQuizzes />} />
          <Route path="/quiz/:quizId" element={<QuizTake />} />
          <Route path="/recap/:sessionId" element={<LectureRecap />} />
          <Route path="/Material" element={<Material />} />
          <Route path="/UploadMaterial" element={<UploadMaterial />} />
          <Route path="/studentChat" element={<StudentChat />} />
          <Route path="/studentProfile" element={<StudentProfile />} />
          <Route path="/adminDashboard" element={<AdminDashboard />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
