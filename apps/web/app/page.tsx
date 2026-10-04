"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { api } from "@daih/api-client";
import { FacilityResource } from "@daih/types";
import { VerifiedReviewsSection } from "../components/home/VerifiedReviewsSection";

export default function HomePage() {
  const [resources, setResources] = useState<FacilityResource[]>([]);

  useEffect(() => {
    api.catalogue
      .getResources()
      .then((data) => {
        if (data && data.length > 0) {
          setResources(data);
        }
      })
      .catch(() => {});
  }, []);

  const getPlanPrice = (slugKeywords: string[], fallbackDaily: number) => {
    const res = resources.find((r) =>
      slugKeywords.some((k) => (r.slug || r.name).toLowerCase().includes(k)),
    );
    if (!res) return fallbackDaily.toLocaleString();

    const dailyPlan = res.pricing?.find((p) => p.durationDays === 1);
    const price = dailyPlan?.price || res.dailyRate || fallbackDaily;
    return Number(price).toLocaleString();
  };

  const flexDeskPrice = getPlanPrice(["flex", "hot"], 4000);
  const dedicatedDeskPrice = getPlanPrice(["dedicated"], 6000);
  const officeSuitePrice = getPlanPrice(["office", "suite", "private"], 8000);

  return (
    <>
      {/* Carousel Wrapper */}
      <section
        id="de-carousel"
        className="no-top no-bottom carousel slide carousel-fade shadow-2-strong"
        data-mdb-ride="carousel"
      >
        {/* Indicators */}
        <ol className="carousel-indicators">
          <li
            data-mdb-target="#de-carousel"
            data-mdb-slide-to="0"
            className="active"
          ></li>
          <li data-mdb-target="#de-carousel" data-mdb-slide-to="1"></li>
          <li data-mdb-target="#de-carousel" data-mdb-slide-to="2"></li>
        </ol>

        {/* Inner */}
        <div className="carousel-inner">
          {/* Single item 1 */}
          <div
            className="carousel-item active"
            style={{
              backgroundImage: "url(/images/slider/1.jpg)",
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          >
            <div className="mask">
              <div className="d-flex justify-content-center align-items-center h-100">
                <div className="container text-white text-center">
                  <div className="row">
                    <div className="col-md-6 offset-md-3">
                      <h1 className="mb-3 animate-carousel-title">
                        Work. Meet. Create. Grow.
                      </h1>
                      <p className="lead animate-carousel-lead">
                        Welcome to Dare Adeboye Innovation Hub (DAIH) — flexible
                        workspaces designed for focus, collaboration, and
                        productivity in Redemption City, Ogun State.
                      </p>
                      <div className="spacer-10"></div>
                      <Link
                        href="/our-plans"
                        className="btn-main animate-carousel-btn"
                      >
                        View Our Plans
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Single item 2 */}
          <div
            className="carousel-item"
            style={{
              backgroundImage: "url(/images/slider/2.jpg)",
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          >
            <div className="mask">
              <div className="d-flex justify-content-center align-items-center h-100">
                <div className="container text-white text-center">
                  <div className="row">
                    <div className="col-md-6 offset-md-3">
                      <h1 className="mb-3 animate-carousel-title">
                        Modern &amp; comfortable spaces to work
                      </h1>
                      <p className="lead animate-carousel-lead">
                        Enjoy ergonomic furniture, serene common areas, and
                        reliable facilities that keep you comfortable and
                        productive throughout the day.
                      </p>
                      <div className="spacer-10"></div>
                      <Link
                        href="/our-plans"
                        className="btn-main animate-carousel-btn"
                      >
                        View Our Plans
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Single item 3 */}
          <div
            className="carousel-item"
            style={{
              backgroundImage: "url(/images/slider/3.jpg)",
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          >
            <div className="mask">
              <div className="d-flex justify-content-center align-items-center h-100">
                <div className="container text-white text-center">
                  <div className="row">
                    <div className="col-md-6 offset-md-3">
                      <h1 className="mb-3 animate-carousel-title">
                        A workspace for every need
                      </h1>
                      <p className="lead animate-carousel-lead">
                        From flex desks and dedicated desks to private offices,
                        training rooms, rooftop lounges, and creative studios —
                        choose what fits your work style.
                      </p>
                      <div className="spacer-10"></div>
                      <Link
                        href="/our-plans"
                        className="btn-main animate-carousel-btn"
                      >
                        View Our Plans
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Controls */}
        <a
          className="carousel-control-prev"
          href="#de-carousel"
          role="button"
          data-mdb-slide="prev"
        >
          <span
            className="carousel-control-prev-icon"
            aria-hidden="true"
          ></span>
          <span className="sr-only">Previous</span>
        </a>
        <a
          className="carousel-control-next"
          href="#de-carousel"
          role="button"
          data-mdb-slide="next"
        >
          <span
            className="carousel-control-next-icon"
            aria-hidden="true"
          ></span>
          <span className="sr-only">Next</span>
        </a>
      </section>

      {/* Select Your Plan Section */}
      <section id="section-pricing">
        <div className="container">
          <div className="row">
            <div className="col-md-6 offset-md-3">
              <div className="text-center">
                <h2>Select Your Plan</h2>
                <p className="mt10 mb0">
                  Pick a space that fits your work style — and scale as you
                  grow.
                </p>
                <div className="spacer-20"></div>
              </div>
            </div>
          </div>

          {/* Pricing Cards */}
          <div className="item pricing">
            <div className="row">
              {/* Flex Desk */}
              <div className="col-12 col-md-6 col-lg-4 mb-4">
                <div className="pricing-s1 mb30 h-100 d-flex flex-column justify-content-between">
                  <div className="top">
                    <h2>Flex Desk</h2>
                    <p className="plan-tagline">
                      Best for flexibility &amp; daily focus
                    </p>
                  </div>

                  <div className="mid bg-color-secondary text-light">
                    <p className="price">
                      <span className="currency">₦</span>
                      <span className="m opt-1">{flexDeskPrice}</span>
                      <span className="month">/day</span>
                    </p>
                  </div>

                  <div className="bottom flex-grow-1">
                    <ul>
                      <li>
                        <i className="fa fa-check"></i>Dedicated workstation
                        access
                      </li>
                      <li>
                        <i className="fa fa-check"></i>High-speed internet /
                        Wi-Fi
                      </li>
                      <li>
                        <i className="fa fa-check"></i>Comfortable ergonomic
                        seating
                      </li>
                      <li>
                        <i className="fa fa-check"></i>24/7 power supply &amp;
                        charging
                      </li>
                      <li>
                        <i className="fa fa-check"></i>Secure environment (CCTV)
                      </li>
                      <li>
                        <i className="fa fa-check"></i>Water (hot &amp; cold)
                      </li>
                    </ul>
                  </div>

                  <div className="action mt-auto">
                    <Link
                      href="/flex-desk"
                      className="btn-main w-100 d-block text-center"
                    >
                      Book Now
                    </Link>
                  </div>
                </div>
              </div>

              {/* Dedicated Desk */}
              <div className="col-12 col-md-6 col-lg-4 mb-4">
                <div className="pricing-s1 mb30 h-100 d-flex flex-column justify-content-between">
                  <div className="top">
                    <h2>Dedicated Desk</h2>
                    <p className="plan-tagline">
                      Best for consistency &amp; productivity
                    </p>
                  </div>

                  <div className="mid bg-color-secondary text-light">
                    <p className="price">
                      <span className="currency">₦</span>
                      <span className="m opt-1">{dedicatedDeskPrice}</span>
                      <span className="month">/day</span>
                    </p>
                  </div>

                  <div className="bottom flex-grow-1">
                    <ul>
                      <li>
                        <i className="fa fa-check"></i>Assigned personal
                        workstation
                      </li>
                      <li>
                        <i className="fa fa-check"></i>High-speed internet /
                        Wi-Fi
                      </li>
                      <li>
                        <i className="fa fa-check"></i>Ergonomic office chair
                      </li>
                      <li>
                        <i className="fa fa-check"></i>Personal desk drawer /
                        storage
                      </li>
                      <li>
                        <i className="fa fa-check"></i>24/7 power supply
                      </li>
                      <li>
                        <i className="fa fa-check"></i>Daily dedicated access
                      </li>
                    </ul>
                  </div>

                  <div className="action mt-auto">
                    <Link
                      href="/dedicated-desk"
                      className="btn-main w-100 d-block text-center"
                    >
                      Book Now
                    </Link>
                  </div>
                </div>
              </div>

              {/* Private Office / Suite */}
              <div className="col-12 col-md-6 col-lg-4 mb-4">
                <div className="pricing-s1 mb30 h-100 d-flex flex-column justify-content-between">
                  <div className="top">
                    <h2>Private Office</h2>
                    <p className="plan-tagline">
                      Best for privacy &amp; executive teams
                    </p>
                  </div>

                  <div className="mid bg-color-secondary text-light">
                    <p className="price">
                      <span className="currency">₦</span>
                      <span className="m opt-1">{officeSuitePrice}</span>
                      <span className="month">/day</span>
                    </p>
                  </div>

                  <div className="bottom flex-grow-1">
                    <ul>
                      <li>
                        <i className="fa fa-check"></i>Private, air-conditioned
                        team suite
                      </li>
                      <li>
                        <i className="fa fa-check"></i>High-speed internet /
                        Wi-Fi
                      </li>
                      <li>
                        <i className="fa fa-check"></i>Presentation screen / TV
                      </li>
                      <li>
                        <i className="fa fa-check"></i>24/7 power supply
                      </li>
                      <li>
                        <i className="fa fa-check"></i>Comfortable team seating
                      </li>
                      <li>
                        <i className="fa fa-check"></i>On-site dedicated support
                      </li>
                    </ul>
                  </div>

                  <div className="action mt-auto">
                    <Link
                      href="/private-office"
                      className="btn-main w-100 d-block text-center"
                    >
                      Book Now
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="text-center mt-4 pt-2">
            <Link href="/our-plans" className="btn-main btn-view-all-plans">
              <span>View All Plans &amp; Facilities</span>
              <i
                className="fa fa-arrow-right"
                style={{ marginLeft: "8px" }}
              ></i>
            </Link>
          </div>
        </div>
      </section>

      {/* Why Choose Us */}
      <section id="section-why-choose-us" className="pt60 pb60">
        <div className="container">
          <div className="row align-items-center">
            <div className="col-lg-12">
              <div className="text-center">
                <h2>Why Choose Us?</h2>
                <div className="small-border bg-color"></div>
                <p className="mt10 mb0">
                  Everything you need to work, meet, train, and grow — in one
                  inspiring hub.
                </p>
              </div>
            </div>

            <div className="col-md-6 why-media">
              <img
                src="/images/misc/images-set-2.png"
                className="lazy img-fluid"
                alt="DAIH workspaces"
              />
            </div>

            <div className="col-md-6">
              <div className="row g-4 align-items-stretch">
                <div className="col-12 col-lg-6 d-flex">
                  <div className="w-100">
                    <h4>Flexible Workspaces</h4>
                    <p>
                      Choose from flex desks to dedicated desks, private
                      offices, conference rooms, or training halls — find the
                      workspace that perfectly suits your needs.
                    </p>
                  </div>
                </div>

                <div className="col-12 col-lg-6 d-flex">
                  <div className="w-100">
                    <h4>High-Speed Connectivity</h4>
                    <p>
                      Our state-of-the-art infrastructure ensures seamless,
                      reliable internet connectivity to keep you productive and
                      connected.
                    </p>
                  </div>
                </div>

                <div className="col-12 col-lg-6 d-flex">
                  <div className="w-100">
                    <h4>Productivity &amp; Comfort</h4>
                    <p>
                      Inspiring private spaces, serene common areas, and modern
                      training rooms — ergonomically designed to support focus
                      and well-being.
                    </p>
                  </div>
                </div>

                <div className="col-12 col-lg-6 d-flex">
                  <div className="w-100">
                    <h4>24/7 Power Supply</h4>
                    <p>
                      Work whenever inspiration hits — with reliable power
                      available around the clock.
                    </p>
                  </div>
                </div>

                <div className="col-12">
                  <h4>Collaborative Environment</h4>
                  <p className="mb-0">
                    Communal areas and conference rooms make it easy to
                    brainstorm, host team meetings, and network with other
                    professionals.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Space Type Section */}
      <section id="section-studio-type">
        <div className="container">
          <div className="row align-items-center">
            <div className="col-lg-12">
              <div className="text-center">
                <h2>Space Type</h2>
                <div className="small-border bg-color-2"></div>
              </div>
            </div>

            <div className="col-md-4">
              <div className="de-image-text">
                <Link href="/studio" className="d-text">
                  <h3>
                    <span className="id-color">01</span> Podcast
                  </h3>
                  <p>
                    Record with clarity in a focused space designed for great
                    audio and smooth sessions.
                  </p>
                </Link>
                <img
                  src="/images/misc/space-type-podcast.jpg"
                  className="img-fluid"
                  alt="Podcast space"
                />
              </div>
            </div>

            <div className="col-md-4">
              <div className="de-image-text">
                <Link href="/studio" className="d-text">
                  <h3>
                    <span className="id-color">02</span> Live Streaming
                  </h3>
                  <p>
                    Stream confidently with reliable power and a professional
                    environment.
                  </p>
                </Link>
                <img
                  src="/images/misc/space-type-streaming.jpg"
                  className="img-fluid"
                  alt="Live streaming space"
                />
              </div>
            </div>

            <div className="col-md-4">
              <div className="de-image-text">
                <Link href="/rooftop-lounge" className="d-text">
                  <h3>
                    <span className="id-color">03</span> Photo &amp; Video Shoot
                  </h3>
                  <p>
                    Create standout content with a clean setup that supports
                    your production needs.
                  </p>
                </Link>
                <img
                  src="/images/misc/space-type-photo.jpg"
                  className="img-fluid"
                  alt="Photo and video space"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Verified Member Reviews Section */}
      <VerifiedReviewsSection />

      {/* Location Section */}
      <section id="section-location">
        <div className="container">
          <div className="row align-items-center">
            <div className="col-lg-12">
              <div className="text-center">
                <h2>Location on Maps</h2>
                <div className="small-border bg-color"></div>
              </div>
            </div>

            <div className="de-map-wrapper">
              <iframe
                src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d31693.13043940911!2d3.4250770906621844!3d6.813409428401215!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x103bcf2e85559e8d%3A0x7283a79ca2ebc02b!2sThe%20Dare%20Adeboye%20Innovation%20Hub%20-%20DAIH!5e0!3m2!1sen!2sng!4v1707407423279!5m2!1sen!2sng"
                allowFullScreen
                loading="lazy"
              ></iframe>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
