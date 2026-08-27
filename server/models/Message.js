import React, { useEffect, useMemo, useState } from "react";

import { Link, useNavigate } from "react-router-dom";

import "./ProviderHome.css";

function ProviderHome() {
  const navigate = useNavigate();

  const API_URL = import.meta.env.VITE_API_URL;

  const token = localStorage.getItem("pataKaziToken");

  const savedUser = JSON.parse(localStorage.getItem("pataKaziUser"));

  const [jobs, setJobs] = useState([]);

  const [myJobs, setMyJobs] = useState([]);

  const [jobsLoading, setJobsLoading] = useState(false);

  const [message, setMessage] = useState("");

  const [searchTerm, setSearchTerm] = useState("");

  const [locationFilter, setLocationFilter] = useState("");

  const [categoryFilter, setCategoryFilter] = useState("");

  const providerServices = savedUser?.services || [];

  const providerFirstName = savedUser?.fullName?.split(" ")[0] || "Provider";

  /*
  ========================================
  LOAD PROVIDER DATA
  ========================================
  */

  useEffect(() => {
    if (!token) {
      navigate("/");
      return;
    }

    if (savedUser?.role !== "provider") {
      navigate("/home");
      return;
    }

    const loadProviderData = async () => {
      try {
        setJobsLoading(true);

        setMessage("");

        /*
          OPEN JOBS
          */

        const openResponse = await fetch(`${API_URL}/api/tasks/open`, {
          method: "GET",

          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const openData = await openResponse.json();

        if (!openResponse.ok) {
          setMessage(openData.message || "Unable to load available jobs.");

          return;
        }

        setJobs(Array.isArray(openData) ? openData : []);

        /*
          MY ASSIGNED JOBS
          */

        const myJobsResponse = await fetch(
          `${API_URL}/api/tasks/provider/my-jobs`,
          {
            method: "GET",

            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        );

        const myJobsData = await myJobsResponse.json();

        if (!myJobsResponse.ok) {
          console.error("Unable to load assigned jobs:", myJobsData);
        } else {
          setMyJobs(Array.isArray(myJobsData) ? myJobsData : []);
        }
      } catch (error) {
        console.error("Provider dashboard error:", error);

        setMessage("Unable to connect to the server.");
      } finally {
        setJobsLoading(false);
      }
    };

    loadProviderData();
  }, [API_URL, navigate, savedUser?.role, token]);

  /*
  ========================================
  FILTER AVAILABLE JOBS
  ========================================
  */

  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      const searchMatch =
        !searchTerm ||
        job.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        job.description?.toLowerCase().includes(searchTerm.toLowerCase());

      const locationMatch =
        !locationFilter ||
        job.location?.toLowerCase().includes(locationFilter.toLowerCase());

      const categoryMatch = !categoryFilter || job.category === categoryFilter;

      return searchMatch && locationMatch && categoryMatch;
    });
  }, [jobs, searchTerm, locationFilter, categoryFilter]);

  const matchingJobs = jobs.filter((job) =>
    providerServices.includes(job.category),
  );

  /*
  ========================================
  LOGOUT
  ========================================
  */

  const handleLogout = () => {
    localStorage.removeItem("pataKaziToken");

    localStorage.removeItem("pataKaziUser");

    navigate("/");
  };

  /*
  ========================================
  FORMATTERS
  ========================================
  */

  const formatBudget = (amount) => {
    return Number(amount || 0).toLocaleString();
  };

  const formatDate = (dateValue) => {
    if (!dateValue) {
      return "";
    }

    return new Date(dateValue).toLocaleDateString("en-KE", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const categories = [
    "Cleaning",
    "Moving",
    "Furniture Assembly",
    "Handyman",
    "Delivery",
    "Yard Work",
  ];

  return (
    <div className="provider-home-page">
      {/* NAVBAR */}

      <nav className="provider-navbar">
        <div className="provider-navbar-container">
          <Link to="/provider" className="provider-logo">
            Pata Kazi
          </Link>

          <div className="provider-nav-links">
            <a href="#my-jobs">My Jobs</a>

            <a href="#available-jobs">Find Jobs</a>

            <a href="#services">My Services</a>

            <Link to="/provider-account">Provider Profile</Link>
          </div>

          <div className="provider-user-area">
            <Link to="/provider-account" className="provider-profile-chip">
              <div className="provider-profile-avatar">
                {savedUser?.fullName?.charAt(0).toUpperCase() || "P"}
              </div>

              <div className="provider-profile-info">
                <span className="provider-profile-name">
                  {savedUser?.fullName || "Provider"}
                </span>

                <small>Service Provider</small>
              </div>
            </Link>

            <button
              type="button"
              className="provider-logout-button"
              onClick={handleLogout}
            >
              Log out
            </button>
          </div>
        </div>
      </nav>

      <main>
        {/* HERO */}

        <section className="provider-dashboard-hero">
          <div className="provider-dashboard-container">
            <div className="provider-welcome-block">
              <span className="provider-dashboard-badge">
                Provider Dashboard
              </span>

              <h1>Welcome back, {providerFirstName}.</h1>

              <p>
                Manage your active work, find new jobs, and grow your reputation
                on Pata Kazi.
              </p>

              <div className="provider-dashboard-actions">
                <a href="#available-jobs" className="provider-main-action">
                  Find new jobs
                </a>

                <a href="#my-jobs" className="provider-outline-action">
                  View my jobs
                </a>
              </div>
            </div>

            <div className="provider-profile-summary-card">
              <div className="provider-summary-avatar">
                {savedUser?.fullName?.charAt(0).toUpperCase() || "P"}
              </div>

              <div className="provider-summary-text">
                <p>Provider profile</p>

                <h3>{savedUser?.fullName}</h3>

                <span>{savedUser?.location || "Location not added"}</span>
              </div>

              <Link
                to="/provider-account"
                className="provider-profile-edit-link"
              >
                Manage
              </Link>
            </div>
          </div>
        </section>

        {/* STATS */}

        <section className="provider-stats-section">
          <div className="provider-content-container">
            <div className="provider-stats-grid">
              <div className="provider-stat-card">
                <p>Active Jobs</p>

                <strong>
                  {myJobs.filter((job) => job.status !== "completed").length}
                </strong>

                <span>Jobs you were hired for</span>
              </div>

              <div className="provider-stat-card">
                <p>Available Jobs</p>

                <strong>{jobs.length}</strong>

                <span>Open customer jobs</span>
              </div>

              <div className="provider-stat-card">
                <p>Matching Jobs</p>

                <strong>{matchingJobs.length}</strong>

                <span>Match your services</span>
              </div>

              <div className="provider-stat-card">
                <p>Rating</p>

                <strong>
                  {savedUser?.rating > 0 ? savedUser.rating : "New"}
                </strong>

                <span>Provider reputation</span>
              </div>
            </div>
          </div>
        </section>

        {/* =================================
            MY ACTIVE JOBS
        ================================= */}

        <section className="provider-jobs-section" id="my-jobs">
          <div className="provider-content-container">
            <div className="provider-section-header">
              <div>
                <p className="provider-section-label">Your work</p>

                <h2>My Active Jobs</h2>

                <p>Jobs where a customer has selected you as their provider.</p>
              </div>
            </div>

            {jobsLoading ? (
              <div className="provider-state-card">Loading your jobs...</div>
            ) : myJobs.length === 0 ? (
              <div className="provider-empty-jobs">
                <div className="provider-empty-circle">0</div>

                <h3>No assigned jobs yet</h3>

                <p>
                  When a customer accepts one of your offers, the job will
                  appear here.
                </p>
              </div>
            ) : (
              <div className="provider-jobs-grid">
                {myJobs.map((job) => (
                  <article className="provider-job-card" key={job._id}>
                    <div className="provider-job-card-top">
                      <div>
                        <span className="provider-match-badge">
                          {job.status}
                        </span>
                      </div>

                      <span className="provider-job-date">
                        {formatDate(job.updatedAt)}
                      </span>
                    </div>

                    <h3>{job.title}</h3>

                    <p className="provider-job-description">
                      {job.description}
                    </p>

                    <div className="provider-job-meta">
                      <div>
                        <span>Service</span>

                        <strong>{job.category}</strong>
                      </div>

                      <div>
                        <span>Location</span>

                        <strong>{job.location}</strong>
                      </div>

                      <div>
                        <span>Agreed price</span>

                        <strong>
                          KES{" "}
                          {formatBudget(
                            job.acceptedOffer?.amount || job.budget,
                          )}
                        </strong>
                      </div>
                    </div>

                    {job.customerId?.fullName && (
                      <div className="provider-job-customer">
                        <span>Customer</span>

                        <strong>{job.customerId.fullName}</strong>
                      </div>
                    )}

                    <div className="provider-job-actions">
                      <Link
                        to={`/provider/job/${job._id}`}
                        className="provider-view-job-button"
                      >
                        View active job
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* SERVICES */}

        <section className="provider-services-section" id="services">
          <div className="provider-content-container">
            <div className="provider-section-header">
              <div>
                <p className="provider-section-label">Your profile</p>

                <h2>Services you offer</h2>

                <p>These services help Pata Kazi match you with jobs.</p>
              </div>

              <Link to="/provider-account" className="provider-small-button">
                Edit services
              </Link>
            </div>

            {providerServices.length === 0 ? (
              <div className="provider-empty-services">
                <div className="provider-empty-circle">+</div>

                <div>
                  <h3>Add your services</h3>

                  <p>
                    Add the work you can perform so you receive better job
                    matches.
                  </p>

                  <Link to="/provider-account" className="provider-main-action">
                    Complete profile
                  </Link>
                </div>
              </div>
            ) : (
              <div className="provider-service-list">
                {providerServices.map((service) => (
                  <div className="provider-service-card" key={service}>
                    <div className="provider-service-letter">
                      {service.charAt(0)}
                    </div>

                    <div>
                      <h3>{service}</h3>

                      <p>You can receive jobs in this category.</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* =================================
            AVAILABLE JOBS
        ================================= */}

        <section className="provider-jobs-section" id="available-jobs">
          <div className="provider-content-container">
            <div className="provider-section-header">
              <div>
                <p className="provider-section-label">Marketplace</p>

                <h2>Available Jobs</h2>

                <p>Browse new jobs posted by customers.</p>
              </div>
            </div>

            <div className="provider-job-filters">
              <input
                type="text"
                placeholder="Search jobs..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />

              <input
                type="text"
                placeholder="Location..."
                value={locationFilter}
                onChange={(e) => setLocationFilter(e.target.value)}
              />

              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="">All services</option>

                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </div>

            {message && <div className="provider-state-card">{message}</div>}

            {!message && filteredJobs.length === 0 ? (
              <div className="provider-empty-jobs">
                <div className="provider-empty-circle">0</div>

                <h3>No available jobs</h3>

                <p>New customer jobs will appear here.</p>
              </div>
            ) : (
              <div className="provider-jobs-grid">
                {filteredJobs.map((job) => {
                  const isMatch = providerServices.includes(job.category);

                  return (
                    <article className="provider-job-card" key={job._id}>
                      <div className="provider-job-card-top">
                        <div>
                          <span className="provider-job-status">Open</span>

                          {isMatch && (
                            <span className="provider-match-badge">Match</span>
                          )}
                        </div>

                        <span className="provider-job-date">
                          {formatDate(job.createdAt)}
                        </span>
                      </div>

                      <h3>{job.title}</h3>

                      <p className="provider-job-description">
                        {job.description}
                      </p>

                      <div className="provider-job-meta">
                        <div>
                          <span>Service</span>

                          <strong>{job.category}</strong>
                        </div>

                        <div>
                          <span>Location</span>

                          <strong>{job.location}</strong>
                        </div>

                        <div>
                          <span>Budget</span>

                          <strong>KES {formatBudget(job.budget)}</strong>
                        </div>
                      </div>

                      <div className="provider-job-actions">
                        <Link
                          to={`/provider/job/${job._id}`}
                          className="provider-view-job-button"
                        >
                          View job
                        </Link>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </main>

      <footer className="provider-footer">
        <div className="provider-footer-container">
          <div>
            <h3>Pata Kazi</h3>

            <p>Find work. Build trust. Grow your income.</p>
          </div>

          <p>© 2026 Pata Kazi. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

export default ProviderHome;
