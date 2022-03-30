var numFormat = d3.format(',');
var shortenNumFormat = d3.format('.2s');
var percentFormat = d3.format('.1%');
var dateFormat = d3.utcFormat("%b %d, %Y");
var chartDateFormat = d3.utcFormat("%-m/%-d/%y");
var colorRange = ['#F7FCB9', '#D9F0A3', '#ADDD8E', '#78C679', '#41AB5D'];
var populationColorRange = ['#F7FCB9', '#D9F0A3', '#ADDD8E', '#78C679', '#41AB5D', '#238443', '#005A32'];
var eventColorRange = ['#EEB598','#CE7C7F','#60A2A4','#91C4B7'];
var idpColorRange = ['#D1E3EA','#BBD1E6','#ADBCE3','#B2B3E0','#A99BC6'];
var orgsRange = ['#d5efe6','#c5e1db','#91c4bb','#81aaa4','#6b8883'];
var colorDefault = '#F2F2EF';
var colorNoData = '#FFF';
var regionBoundaryData, regionalData, nationalData, subnationalDataByCountry, dataByCountry, colorScale, viewportWidth, viewportHeight = '';
var countryTimeseriesChart = '';
var mapLoaded = false;
var dataLoaded = false;
var viewInitialized = false;
var isMobile = false;
var zoomLevel = 1.4;
var minZoom = 4;

var globalCountryList = [];
var currentCountryIndicator = {};
var currentCountry = {};

var refugeeTimeseriesData, refugeeCountData, borderCrossingData, acledData, locationData, hostilityData, refugeeLineData, cleanedCoords, idpGeoJson, humIcons = '';

$( document ).ready(function() {
  var prod = (window.location.href.indexOf('ocha-dap')>-1 || window.location.href.indexOf('data.humdata.org')>-1) ? true : false;
  //console.log(prod);

  mapboxgl.accessToken = 'pk.eyJ1IjoiaHVtZGF0YSIsImEiOiJjbDA5cWZmNjAwZzAyM3BtZ3U3OXNldW1hIn0.Tcs909e7BLLnpWBjM6tuvw';
  var tooltip = d3.select('.tooltip');
  var minWidth = 1000;
  viewportWidth = (window.innerWidth<minWidth) ? minWidth : window.innerWidth;
  viewportHeight = window.innerHeight;


  function init() {
    //detect mobile users
    if( /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ) {
      $('.mobile-message').show();
      isMobile = true;
      minZoom = 1;
      zoomLevel = 3;
    }
    $('.mobile-message').on('click', function() {
      $(this).remove();
    });

    //set content sizes based on viewport
    $('.content').width(viewportWidth);
    $('.content').height(viewportHeight);
    $('.content-right').width(viewportWidth);
    $('.country-panel .panel-content').height(viewportHeight - $('.country-panel .panel-content').position().top);
    $('.map-legend.country').css('max-height', viewportHeight - 200);
    if (viewportHeight<696) {
      zoomLevel = 1.4;
    }

    //load static map -- will only work for screens smaller than 1280
    if (viewportWidth<=1280) {
      var staticURL = 'https://api.mapbox.com/styles/v1/humdata/cl0cqcpm4002014utgdbhcn4q/static/-25,0,2/'+viewportWidth+'x'+viewportHeight+'?access_token='+mapboxgl.accessToken;
      $('#static-map').css('background-image', 'url('+staticURL+')');
    }

    getData();
    initMap();
  }

  function getData() {
    console.log('Loading data...')
    Promise.all([
      d3.json('https://raw.githubusercontent.com/OCHA-DAP/hdx-scraper-ukraine-viz/main/all.json'),
      d3.json('https://raw.githubusercontent.com/OCHA-DAP/hdx-scraper-ukraine-viz/main/UKR_Border_Crossings.geojson'),
      d3.json('data/ee-regions-bbox.geojson'),
      d3.json('data/ukr_refugee_lines.geojson'),
      d3.json('data/wrl_ukr_capp.geojson'),
      d3.json('data/hostilities.geojson'),
      d3.json('data/macro-region.geojson')
    ]).then(function(data) {
      console.log('Data loaded');
      $('.loader span').text('Initializing map...');


      //parse data
      var allData = data[0];
      regionalData = allData.regional_data[0];
      nationalData = allData.national_data;
      subnationalData = allData.subnational_data;
      refugeeTimeseriesData = allData.refugees_series_data;
      acledData = allData.fatalities_data;
      sourcesData = allData.sources_data;
      idpMacroData = allData.idps_macro_data;

      borderCrossingData = data[1];
      regionBoundaryData = data[2].features;
      refugeeLineData = data[3];
      locationData = data[4];
      hostilityData = data[5];
      idpGeoJson = data[6];
            
      //process acled data
      acledData.forEach(function(event) {
        event['#coords'] = [+event['#geo+lon'], +event['#geo+lat']];
      });

      //group by coords
      let coordGroups = d3.nest()
        .key(function(d) { return d['#coords']; })
        .entries(acledData);

      //nudge dots with duplicate coords
      cleanedCoords = [];
      coordGroups.forEach(function(coords) {
        if (coords.values.length>1)
          coords.values.forEach(function(c) {
            let origCoord = turf.point(c['#coords']);
            let bearing = randomNumber(-180, 180); //randomly scatter around origin
            let distance = randomNumber(2, 8); //randomly scatter by 2-8km from origin
            let newCoord = turf.destination(origCoord, distance, bearing);
            c['#coords'] = newCoord.geometry.coordinates;
            cleanedCoords.push(c);
          });
        else {
          cleanedCoords.push(coords.values[0]);
        }
      });


      //remove duplicate towns from location data if it exists in hostility data
      locationData.features = locationData.features.filter(locationObj => hostilityData.features.every(function(hostilityObj) {
        let isDuplicate = (locationObj.properties.TYPE!='TERRITORY') ? locationObj.properties.CAPITAL !== hostilityObj.properties.NAME : true;
        return isDuplicate;
      }));
      

      //format data
      subnationalData.forEach(function(item) {
        var pop = item['#population'];
        if (item['#population']!=undefined) item['#population'] = parseInt(pop.replace(/,/g, ''), 10);
      });

      //parse national data
      nationalData.forEach(function(item) {
        //keep global list of countries
        globalCountryList.push({
          'name': item['#country+name'],
          'code': item['#country+code']
        });
        globalCountryList.sort(function(a,b) {
          return (a.name < b.name) ? -1 : (a.name > b.name) ? 1 : 0;
        });
      });


      //group national data by country -- drives country panel    
      dataByCountry = d3.nest()
        .key(function(d) { return d['#country+code']; })
        .object(nationalData);


      //map humanitarian icons to sector clusters
      humIcons = {
        'Coordination and Common Services': 'humanitarianicons-Coordination',
        'Education': 'humanitarianicons-Education',
        'Emergency Telecommunications': 'humanitarianicons-Emergency-Telecommunications',
        'Food Security and Livelihoods': 'humanitarianicons-Food-Security',
        'Health': 'humanitarianicons-Health',
        'Multi-purpose Cash': 'humanitarianicons-Fund',
        'Nutrition': 'fa-solid fa-person-breastfeeding',
        'Protection': 'humanitarianicons-Protection',
        'Shelter/NFI': 'humanitarianicons-Shelter',
        'WASH': 'humanitarianicons-Water-Sanitation-and-Hygiene',
      };


      dataLoaded = true;
      if (mapLoaded==true) displayMap();
      initView();
    });
  }

  function initView() {
    //load timeseries for country view 
    initTimeseries('', '.country-timeseries-chart');

    //check map loaded status
    if (mapLoaded==true && viewInitialized==false)
      deepLinkView();

    viewInitialized = true;
  }


  function initCountryView() {
    $('.content').addClass('country-view');
    $('.country-panel').scrollTop(0);
    $('#population').prop('checked', true);
    currentCountryIndicator = {id: $('input[name="countryIndicators"]:checked').val(), name: $('input[name="countryIndicators"]:checked').parent().text()};

    initCountryPanel();
  }


  function initTracking() {
    //initialize mixpanel
    var MIXPANEL_TOKEN = window.location.hostname=='data.humdata.org'? '5cbf12bc9984628fb2c55a49daf32e74' : '99035923ee0a67880e6c05ab92b6cbc0';
    mixpanel.init(MIXPANEL_TOKEN);
    mixpanel.track('page view', {
      'page title': document.title,
      'page type': 'datavis'
    });
  }

  init();
  initTracking();
});