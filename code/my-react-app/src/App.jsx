import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import './App.css';
import Login from './Login.jsx';
import Signup from './Signup.jsx';
import ForgotPassword from './forgotPassword.jsx';
import OtpVerify from './otpVerify.jsx';
import Admin from './adminDashboard.jsx';
import Student from './studentDashboard.jsx';
import Teacher from './teacherDashboard.jsx';
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
import StudentGrades from './StudentGrades.jsx';
import StudentPerformance from './StudentPerformance.jsx';
import ManageMeeting from './manageMeeting.jsx';
import ViewAttendance from './viewAttendance.jsx';
import ManageEnrollment from './manageEnrollment.jsx';
import '@fortawesome/fontawesome-free/css/all.min.css';
import StudentChat from './studentChat.jsx';
import StudentProfile from './studentProfile.jsx';
import ProtectedRoute from './ProtectedRoute.jsx';

function App() {
  return (
    <Router>
      <div className='app-container'>
        <Routes>
          {/* Public routes */}
          <Route path="/" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/ForgotPassword" element={<ForgotPassword />} />
          <Route path="/otpVerify" element={<OtpVerify />} />

          {/* Protected routes */}
          <Route path="/adminDashboard" element={<ProtectedRoute><Admin /></ProtectedRoute>} />
          <Route path="/studentDashboard" element={<ProtectedRoute><Student /></ProtectedRoute>} />
          <Route path="/teacherDashboard" element={<ProtectedRoute><Teacher /></ProtectedRoute>} />
          <Route path="/teacherProfile/:teacherId?" element={<ProtectedRoute><TeacherProfile /></ProtectedRoute>} />
          <Route path="/courseProfile" element={<ProtectedRoute><CourseProfile /></ProtectedRoute>} />
          <Route path="/studentCourseProfile" element={<ProtectedRoute><StudentCourseProfile /></ProtectedRoute>} />
          <Route path="/scheduleForm" element={<ProtectedRoute><ScheduleForm /></ProtectedRoute>} />
          <Route path="/updateForm" element={<ProtectedRoute><UpdateForm /></ProtectedRoute>} />
          <Route path="/manageMeeting" element={<ProtectedRoute><ManageMeeting /></ProtectedRoute>} />
          <Route path="/manageEnrollment" element={<ProtectedRoute><ManageEnrollment /></ProtectedRoute>} />
          <Route path="/attendance/:sessionId" element={<ProtectedRoute><ViewAttendance /></ProtectedRoute>} />
          <Route path="/chatPage" element={<ProtectedRoute><Chat /></ProtectedRoute>} />
          <Route path="/meeting/:meetingId" element={<ProtectedRoute><MeetingRoom /></ProtectedRoute>} />
          <Route path="/studentQuizzes" element={<ProtectedRoute><StudentQuizzes /></ProtectedRoute>} />
          <Route path="/quiz/:quizId" element={<ProtectedRoute><QuizTake /></ProtectedRoute>} />
          <Route path="/studentGrades" element={<ProtectedRoute><StudentGrades /></ProtectedRoute>} />
          <Route path="/studentPerformance" element={<ProtectedRoute><StudentPerformance /></ProtectedRoute>} />
          <Route path="/recap/:sessionId" element={<ProtectedRoute><LectureRecap /></ProtectedRoute>} />
          <Route path="/Material" element={<ProtectedRoute><Material /></ProtectedRoute>} />
          <Route path="/UploadMaterial" element={<ProtectedRoute><UploadMaterial /></ProtectedRoute>} />
          <Route path="/studentChat" element={<ProtectedRoute><StudentChat /></ProtectedRoute>} />
          <Route path="/studentProfile" element={<ProtectedRoute><StudentProfile /></ProtectedRoute>} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
