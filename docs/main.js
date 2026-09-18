// pet-bot 官网交互脚本：滚动入场、导航态、轻量视差、角色跟随
(function () {
  'use strict';

  // ---- 1. 滚动入场：IntersectionObserver 逐个揭示 .reveal 元素 ----
  var revealEls = Array.prototype.slice.call(document.querySelectorAll('.reveal'));

  if ('IntersectionObserver' in window && revealEls.length) {
    // 同一容器内的多个元素依次错峰出现
    var groups = {};
    revealEls.forEach(function (el) {
      var parent = el.parentElement;
      var key = parent ? (parent.className || 'root') : 'root';
      groups[key] = groups[key] || [];
      groups[key].push(el);
    });
    Object.keys(groups).forEach(function (key) {
      groups[key].forEach(function (el, i) {
        el.style.transitionDelay = Math.min(i * 90, 540) + 'ms';
      });
    });

    var io = new IntersectionObserver(
      function (entries, obs) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('in');
            obs.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -8% 0px' }
    );
    revealEls.forEach(function (el) {
      io.observe(el);
    });
  } else {
    // 不支持时兜底：直接全部显示
    revealEls.forEach(function (el) {
      el.classList.add('in');
    });
  }

  // ---- 2. 平滑锚点滚动 ----
  document.querySelectorAll('a[href^="#"]').forEach(function (link) {
    link.addEventListener('click', function (e) {
      var id = link.getAttribute('href');
      if (!id || id === '#') return;
      var target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  // ---- 3. 导航栏滚动态（scrolled）----
  var nav = document.querySelector('.nav');
  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(function () {
      var y = window.scrollY || window.pageYOffset;
      if (nav) {
        nav.classList.toggle('scrolled', y > 24);
      }
      // 极光轻量视差
      var blobs = document.querySelectorAll('.aurora .blob');
      blobs.forEach(function (b, i) {
        var factor = (i + 1) * 0.03;
        b.style.transform = 'translateY(' + (y * factor).toFixed(1) + 'px)';
      });
      ticking = false;
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ---- 4. 角色随鼠标轻微跟随（仅桌面、尊重减少动效偏好）----
  var prefersReduced =
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var stage = document.querySelector('.stage');
  if (stage && !prefersReduced && window.matchMedia('(pointer: fine)').matches) {
    window.addEventListener(
      'mousemove',
      function (e) {
        var cx = window.innerWidth / 2;
        var cy = window.innerHeight / 2;
        var dx = (e.clientX - cx) / cx; // -1 ~ 1
        var dy = (e.clientY - cy) / cy;
        stage.style.setProperty('--tilt-x', (dx * 6).toFixed(2) + 'deg');
        stage.style.setProperty('--tilt-y', (-dy * 6).toFixed(2) + 'deg');
      },
      { passive: true }
    );
  }

  // ---- 5. 页脚年份（如存在占位）----
  var yearEl = document.querySelector('[data-year]');
  if (yearEl) {
    yearEl.textContent = String(new Date().getFullYear());
  }
})();
