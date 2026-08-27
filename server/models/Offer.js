import { BrowserRouter, Routes, Route } from "react-router-dom";

import Login from "./login/login";
import Signup from "./signup/signup";

import Home from "./home/home";
import Account from "./account/account";

import Terms from "./terms/terms";

import PostTask from "./tasks/PostTask";

import MatchingProviders from "./tasks/MatchingProviders";

import ProviderHome from "./provider/ProviderHome";

import ProviderJob from "./provider/ProviderJob";

import ProviderAccount from "./provider/ProviderAccount";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* LOGIN */}
        <Route path="/" element={<Login />} />

        {/* SIGNUP */}
        <Route path="/signup" element={<Signup />} />

        {/* CUSTOMER HOME */}
        <Route path="/home" element={<Home />} />

        {/* CUSTOMER ACCOUNT */}
        <Route path="/account" element={<Account />} />

        {/* TERMS */}
        <Route path="/terms" element={<Terms />} />

        {/* CUSTOMER POSTS TASK */}
        <Route path="/post-task" element={<PostTask />} />

        {/* CUSTOMER PROVIDER MATCHES */}
        <Route path="/task/:taskId/providers" element={<MatchingProviders />} />

        {/* PROVIDER HOME */}
        <Route path="/provider" element={<ProviderHome />} />

        {/* PROVIDER ACCOUNT */}
        <Route path="/provider-account" element={<ProviderAccount />} />

        {/* PROVIDER JOB */}
        <Route path="/provider/job/:jobId" element={<ProviderJob />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
