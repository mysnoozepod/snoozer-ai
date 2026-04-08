import React from "react";

export default function WelcomeView() {
  return (
    <div className="min-h-screen bg-stone-100 flex flex-col justify-center items-center px-4 py-12 relative">
      {/* Logo */}
      <img
        src="/assets/logo.svg"
        alt="MySnoozepod Logo"
        className="h-16 mb-6"
      />

      {/* Welcome Text */}
      <h1 className="text-3xl md:text-5xl font-bold text-center text-gray-800">
        Welcome To MySnoozepod
      </h1>

      {/* Access Code Input */}
      <div className="w-full max-w-md mt-8">
        <input
          type="text"
          placeholder="Enter Access Code"
          className="w-full text-xl px-4 py-3 border border-gray-300 rounded-xl shadow-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      {/* Subheading */}
      <p className="text-lg md:text-xl text-center text-gray-600 mt-4">
        Where your Sleep Health & Wellness Journey Begins
      </p>

      {/* Start Button */}
      <button className="bg-indigo-600 hover:bg-indigo-700 text-white text-lg font-semibold px-6 py-3 rounded-xl mt-6">
        Start Your Snooze Session
      </button>

      {/* Snoozer Avatar */}
      <img
        src="/assets/snoozer-avatar.png"
        alt="Snoozer Avatar"
        className="absolute bottom-4 right-4 h-20 w-20"
      />
    </div>
  );
}
